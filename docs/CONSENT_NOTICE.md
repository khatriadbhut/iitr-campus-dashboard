# DPDP Consent Notice — draft text

**Where it goes:** a standalone screen shown once, immediately after Channel-i sign-in succeeds and **before any row is written to the database**.

**Why standalone:** DPDP Rules 2025 Rule 3(a) requires the notice be "presented and be understandable **independently of any other information**". It cannot be a paragraph inside the privacy policy, and it cannot be a link.

**Rules that shape it:** Rule 3(b)(i) — itemised, field-by-field description ("profile information" is not compliant). Rule 3(b)(ii) — specified purpose per item. Rule 3(c) — the particular link for withdrawal, rights, and Board complaint. Act s.6(1) — no pre-ticked boxes, no bundled agreement. Act s.6(3) — plain language, option to read in English or an Eighth Schedule language.

---

## The screen

### Before you start — what we do with your data

This app is built and run by a student, not by IIT Roorkee. It is free. There are no ads. Nothing here is sold to anyone, ever.

Indian law (the Digital Personal Data Protection Act, 2023) says we have to tell you exactly what we collect and why, in plain words, and then ask you. So here it is.

**What Channel-i sends us when you sign in, and why we need each piece**

| What we get | Why we need it |
|---|---|
| Your name | So the app can greet you and so club coordinators can see who has RSVP'd to their event. |
| Your enrolment number | It is how we tell one account from another. It is also what you quote if you ever ask us to show you or delete your data. |
| Your institute email address | To send you the event reminders you have asked for, and to reach you if something goes wrong with your account. Nothing else. |
| Your branch and year | So the app can show you events relevant to your department and year, instead of everything on campus. |
| Your profile picture | It is shown on your own profile page inside the app. Nobody outside the app can see it. |

**What you create while using the app, and why we keep it**

| What you create | Why we keep it |
|---|---|
| Clubs you follow | To decide which events appear in your feed. |
| Events you RSVP to | So the club knows how many people are coming, and so you can find the event again. The club coordinator for that event sees your name. |
| Your to-dos and reminders | To show them back to you and to send the reminder at the time you set. They are yours; nobody else sees them. |
| Sign-in and error logs | To keep the account secure and to find bugs. The law requires us to hold these for one year. |

**What we do not do**

- We do not track what you click, how long you look at something, or where you go afterwards.
- We do not build a profile of you or guess your interests.
- We do not show ads, and we do not do targeted advertising.
- We do not sell, rent or share your data with any company.
- We do not use any third-party analytics, tracking pixels or advertising tools.

**Where your data lives**

On Amazon Web Services servers in Mumbai, India. Not outside India.

**How long we keep it**

For as long as you have an account. If you delete your account, we erase your data, except sign-in and error logs, which the law makes us keep for one year and which we then erase too.

---

**Please tick to continue**

☐ **I have read the above and I agree to the app using the data listed, for the purposes listed.** *(required — the app cannot work without this)*

☐ **I am 18 years old or older.** *(required — see note below)*

**Optional — you can say no and everything else still works**

☐ Email me a reminder before events I have RSVP'd to. *(you can turn this on or off any time in Settings)*

☐ Email me when a club I follow posts a new event. *(you can turn this on or off any time in Settings)*

---

**Changing your mind**

You can withdraw your consent at any time, and it takes the same two taps it took to give it: **Settings → Privacy → Withdraw consent and delete my account.** When you do, we stop processing your data and erase it, except the sign-in and error logs the law makes us keep for one year. Anything that already happened before you withdrew — an RSVP the club has already counted, for instance — stays as it was; withdrawing does not undo the past.

**Seeing, correcting or deleting your data**

**Settings → Privacy** lets you see everything we hold about you, correct it, or delete it. You will need your enrolment number to confirm it is you.

**If something is wrong and you want it fixed**

Write to **[GRIEVANCE_EMAIL]**. That reaches **[YOUR FULL NAME]**, who built and runs this app and is the person responsible for how your data is handled. We will reply, and resolve it, within **90 days at the outside** — realistically within a week.

**If we do not fix it**

You can then complain to the **Data Protection Board of India**. You have to give us a chance first — that is what the law says — but after that the Board is yours to use. How to reach them: **[LINK — once the Board publishes its complaint page]**.

**Read this in another language:** [English ▾] — *ship English + Hindi. s.6(3) requires the option, not that you write all 22 up front.*

*Full privacy policy: [link]. Terms of use: [link].*

---

## Implementation notes (not shown to users)

1. **Store, per consent event:** `consent_text_version`, SHA-256 of the exact notice rendered, UTC timestamp, and each checkbox's boolean. **s.6(10) puts the burden of proof on you** to show notice was given and consent obtained. This is the highest-value engineering item here.
2. The two optional email toggles must be **independently revocable in Settings** — that is s.6(4)'s "comparable ease" requirement.
3. **Re-prompt with a fresh notice whenever the itemised table changes.** Do not silently version.
4. `[GRIEVANCE_EMAIL]` must also be published on a permanently reachable page and **quoted in every reply** to a rights request (Rule 9).
5. The 18+ checkbox is the contractual footing for the hard age gate. See `LAUNCH_CHECKLIST.md` §6.4 — under-18s get a logged-out, read-only event page instead of an account, because if you process no personal data the Act is not engaged for that user at all.
6. **The "what we do not do" list must stay true.** If you add PostHog (see §4.1), the third and fifth bullets change and this notice must be revised and re-prompted. Analytics choice and this text are coupled.
