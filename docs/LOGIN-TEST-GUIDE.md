# Login Test Guide — run this the moment the IP block is lifted

Login is the gate for the whole product: every route except the academic calendar sits behind it.
Until this passes, nothing else can be verified end to end.

Work top to bottom. **Each step tells you whether to continue or stop**, so a failure points at one
layer instead of leaving you guessing.

---

## Step 0 — Is the network hop actually open?

This is the thing that was blocked. Test it *before* touching a browser, because if this fails
everything below fails for the same reason and you'll waste an hour.

```sh
aws ssm send-command --instance-ids <EC2_INSTANCE_ID> \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["curl -s -o /dev/null -w \"channeli.in: HTTP %{http_code} (%{time_total}s)\\n\" --max-time 15 https://channeli.in/"]' \
  --profile campus --region ap-south-1 --query 'Command.CommandId' --output text
```

Then fetch the output with `aws ssm get-command-invocation --command-id <id> --instance-id <EC2_INSTANCE_ID> --profile campus --region ap-south-1`.

| Result | Meaning |
|---|---|
| `HTTP 200` or `301/302` | **Open.** Continue to step 1 |
| `HTTP 000` after ~15s | Still blocked — a timeout, not a rejection. Stop here |
| `HTTP 403` | Reachable but refusing you. Different problem: they're blocking by address, not dropping packets |

**If it's still blocked, give whoever is whitelisting the server's current outbound address:**

```sh
aws ssm send-command --instance-ids <EC2_INSTANCE_ID> \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["curl -s --max-time 10 https://api.ipify.org; echo"]' \
  --profile campus --region ap-south-1 --query 'Command.CommandId' --output text
```

Note: this changes if the instance is ever stopped and started. If it was whitelisted a while ago,
re-check it matches.

---

## Step 1 — Does the login redirect still build correctly?

```sh
curl -sI https://<CLOUDFRONT_DOMAIN>/api/oauth/login | grep -i '^location'
```

Expect a `302` to `channeli.in/oauth/authorise/` carrying:

- `client_id=` — should start `S9Temz…` (the rotated one, **not** `EnqL08TT…`, which leaked)
- `redirect_uri=https://<CLOUDFRONT_DOMAIN>/api/oauth/token/` — **the `/api` prefix matters**
- `state=` — present and different on every request

**Stop if:** no `state`, or the `redirect_uri` is missing `/api`. Fix before going further.

---

## Step 2 — The real login, on a phone

Not a desktop. Your users are on mid-range Android over campus wifi, and that's where redirect and
cookie problems actually appear.

1. Open **https://<CLOUDFRONT_DOMAIN>/**
2. Tap sign in, complete Channel-i
3. Watch what comes back

| What you see | Meaning | Next |
|---|---|---|
| Logged in, feed loads | **It works.** Go to step 3 | ✓ |
| Channel-i error about the redirect URI | Not whitelisted in the Channel-i app registration — a *different* fix from the IP | Ask your friend |
| Returns to the site but logged out | Cookie or `tv` problem — go to step 4 | |
| Hangs after Channel-i | The token exchange is timing out — step 0 lied, or only partially open | |

---

## Step 3 — Confirm the session actually holds

Being redirected back isn't proof; the cookie has to persist and be accepted.

On the phone, after logging in:

1. **Reload the page.** Still logged in? If not, the cookie isn't being stored.
2. **Close the tab, reopen the site.** Still logged in? If not, it's a session cookie rather than a persistent one.
3. **Open an event, then a club page.** Any 401 means the cookie isn't being sent on subsequent requests.
4. **Log out, then hit back.** Should not still be logged in.

Then confirm the server agrees:

```sh
./scripts/smoke-test.sh
```

`/api/events/all` returning **401** is the pass condition — it proves auth ran and the database was
reachable enough to reject cleanly.

---

## Step 4 — If it returns but you're logged out

Most likely causes, in order:

**A missing `tv` claim.** Tokens now require it. If any code path signs a JWT without reading
`user.token_version`, every request with that token is rejected. Check server logs for
`Session revoked`.

**Cookie not being set.** Check the `Set-Cookie` on the callback response: needs `HttpOnly`,
`Secure`, `SameSite=Lax`, and `Path=/`. `SameSite=Strict` would be dropped on the way back from
Channel-i, since that's a cross-site top-level navigation.

**Server logs:**

```sh
aws ssm send-command --instance-ids <EC2_INSTANCE_ID> \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["docker logs --tail 80 campus_dashboard_backend 2>&1 | grep -iE \"oauth|token|session|revoked\""]' \
  --profile campus --region ap-south-1 --query 'Command.CommandId' --output text
```

---

## Step 5 — Once one login works, test the second person

A single successful login proves the flow. It does **not** prove the rate limiter is sane.

**Get two or three people to log in within a few minutes of each other, from campus wifi.**

This is the specific thing that would break launch day: everyone on campus shares one public address
behind the institute's NAT, so an IP-keyed limiter treats the whole campus as one visitor. The write
limiter is now keyed on the logged-in user, but the **login** limiter still runs pre-auth on IP —
5 failed attempts per 5 minutes, shared.

Watch for `Too many login attempts` when nobody has actually made five attempts. If it appears,
raise the pre-auth limit before announcing anything.

---

## Step 6 — Then, and only then

With login confirmed working, the rest of the checklist becomes testable:

- Admin login → create an event → **upload a poster** (the new S3 path, never tested with a real session)
- Confirm the uploaded image displays in the feed
- Deep link: paste an event URL, open on a phone where you're logged out, log in — **do you land back on that event**, or on a generic home page? If the latter, the sharing loop is dead
- Then `docs/LAUNCH_CHECKLIST.md` from item 4 onward

---

## Record the result

Whatever happens, note it in `docs/DEBUGGING.md` — especially a failure and its cause. This is the
single most likely thing to break again after any infrastructure change, and the next person
debugging it will not have this context.
