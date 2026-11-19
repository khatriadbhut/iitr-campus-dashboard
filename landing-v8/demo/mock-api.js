/* ============================================================
   Campus Dashboard — offline API for the landing-page demo

   This is the REAL app, built from src/. The only thing swapped
   out is the network: XMLHttpRequest is shimmed so every call the
   app makes is answered from memory. Nothing else is stubbed, so
   the whole frontend behaves exactly as it does in production —
   tabs, filters, search, reminders with offsets, calendar
   navigation, todos, club preferences.

   Writes mutate the in-memory store, so changes you make persist
   for the session and read back correctly.
   ============================================================ */
(() => {
  const DAY = 86400000;
  const NOW = new Date();
  const iso = (d, h = 9, m = 0) => {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return x.toISOString().slice(0, 19);
  };
  const inDays = n => new Date(NOW.getTime() + n * DAY);

  /* Exactly the clubs the user named. An earlier pass scraped more out of
     email subject lines and got it wrong: gensec.technical@ and gensec.cult@
     are RELAYS that also carry external and one-off items, so a capitalised
     name in their subject is not an IITR club. Do not add to this list from
     subject lines — only from a body with its own @iitr.ac.in sender, and
     only after checking.
     Ids are referenced by the seeded events below; move the two together. */
  const CLUBS = [
    { id: 1, name: 'Tinkering Lab', club_name: 'Tinkering Lab', description: 'Open workshop for student hardware projects.', email: 'tinkeringlab@iitr.ac.in' },
    { id: 2, name: 'SDS Labs', club_name: 'SDS Labs', description: 'Software development and systems group.', email: 'sdslabs@iitr.ac.in' },
    { id: 3, name: 'Information Management Group (IMG)', club_name: 'Information Management Group (IMG)', description: 'Builds and runs Channel-i and the campus web systems.', email: 'channeli.img@iitr.ac.in' },
    { id: 4, name: 'Models and Robotics Section (MaRS)', club_name: 'Models and Robotics Section (MaRS)', description: 'Models, autonomous machines and robotics.', email: 'mars@iitr.ac.in' },
    { id: 5, name: 'Robocon', club_name: 'Robocon', description: 'The institute team for the ABU Robocon championship.', email: 'robocon@iitr.ac.in' },
    { id: 6, name: 'Thomso', club_name: 'Thomso', description: 'The annual cultural festival.', email: 'thomso@iitr.ac.in' },
    { id: 7, name: 'Cognizance', club_name: 'Cognizance', description: 'The annual technical festival.', email: 'cognizance@iitr.ac.in' },
    { id: 8, name: 'Music Section', club_name: 'Music Section', description: 'Choir, band and the campus music calendar.', email: 'music@iitr.ac.in' },
    { id: 9, name: 'E Cell', club_name: 'E Cell', description: 'Entrepreneurship, startups and TEDxIITRoorkee.', email: 'ecell@iitr.ac.in' },
    { id: 10, name: 'NSS IIT Roorkee', club_name: 'NSS IIT Roorkee', description: 'National Service Scheme volunteering.', email: 'nss@iitr.ac.in' },
    { id: 11, name: 'SocBiz', club_name: 'SocBiz', description: 'Product, analytics and business case work.', email: 'socbiz@iitr.ac.in' },
    { id: 12, name: 'Watch Out IITR', club_name: 'Watch Out IITR', description: 'Campus journalism, film and photography.', email: 'watchout@iitr.ac.in' },
    { id: 13, name: 'Institute Sports Council', club_name: 'Institute Sports Council', description: 'Inter-bhawan and institute sport.', email: 'chairman.isc@iitr.ac.in' }
  ];
  /* Notices. This endpoint used to answer empty, which made the demo's second
     tab the one place the mockup did not behave like the real app — and it is
     the tab that carries the whole colour system: gold for money, blue for a
     position, red when it closes today, amber inside a week. Kinds and the
     opportunity/info split match src/utils/notice.js. */
  const NOTICES = [
    { id: 1, priority: 'important', kind: 'scholarship', is_opportunity: true,
      title: 'Merit-cum-Means Scholarship 2026-27 — applications open',
      body: 'Greetings from the Students Welfare office. Applications for the Merit-cum-Means scholarship for the academic year 2026-27 are now open to all UG students with family income below eight lakh. Submit the income certificate and the last two semester grade cards through the portal.',
      deadline: iso(inDays(1)).slice(0, 10), audience: 'UG',
      source: 'Dean of Students Welfare', published_at: iso(inDays(-2)).slice(0, 10) },
    { id: 2, priority: 'important', kind: 'recruitment', is_opportunity: true,
      title: 'SDSLabs core team recruitment — round one',
      body: 'SDSLabs is recruiting for its core engineering team. Round one is a take-home task covering systems design and web fundamentals. Open to second and third year students across all departments.',
      deadline: iso(inDays(5)).slice(0, 10), audience: 'All',
      source: 'SDSLabs', published_at: iso(inDays(-1)).slice(0, 10) },
    { id: 3, priority: 'general', kind: 'fee', is_opportunity: false,
      title: 'Autumn semester fee payment window',
      body: 'The fee payment window for the autumn semester is now open on the institute portal. Late payment attracts a fine after the closing date. Hostel and mess dues are billed separately this term.',
      deadline: iso(inDays(12)).slice(0, 10), audience: 'All',
      source: 'Accounts Section', published_at: iso(inDays(-3)).slice(0, 10) },
    { id: 4, priority: 'general', kind: 'competition', is_opportunity: true,
      title: 'Inter-IIT Tech Meet — campus selections',
      body: 'Campus selections for the Inter-IIT Technical Meet contingent begin this month. Registration is open to all years across the twelve problem statements released by the host institute.',
      deadline: iso(inDays(20)).slice(0, 10), audience: 'All',
      source: 'Technical Council', published_at: iso(inDays(-4)).slice(0, 10) },
    { id: 5, priority: 'general', kind: 'facility', is_opportunity: false,
      title: 'Swimming pool closed for maintenance',
      body: 'The institute swimming pool will remain closed for annual maintenance and water treatment. The gymnasium and the athletics track stay open through the period.',
      deadline: null, audience: null,
      source: 'Sports Council', published_at: iso(inDays(-1)).slice(0, 10) },
  ];

  const CATS = [
    { id: 1, name: 'Tech' }, { id: 2, name: 'Cultural' },
    { id: 3, name: 'Sports' }, { id: 4, name: 'Talks' }
  ];
  const LOCS = [
    { id: 1, location_name: 'Convocation Hall', location_description: 'Main auditorium' },
    { id: 2, location_name: 'MAC', location_description: 'Multi Activity Centre' },
    { id: 3, location_name: 'LHC 204', location_description: 'Lecture Hall Complex' },
    { id: 4, location_name: 'Main Ground', location_description: 'Sports ground' },
    { id: 5, location_name: 'Tinkering Lab', location_description: 'Workshop space' }
  ];

  const ev = (id, name, clubId, day, h, mins, loc, cats, desc) => ({
    id, name, event_name: name,
    description: desc,
    club_id: clubId,
    club_name: CLUBS.find(c => c.id === clubId).club_name,
    Club: { id: clubId, club_name: CLUBS.find(c => c.id === clubId).club_name },
    location_name: loc, venue_text: loc,
    Location: { location_name: loc },
    categories: cats,
    tentative_start_time: iso(inDays(day), h, 0),
    tentative_end_time: iso(inDays(day), h + Math.floor(mins / 60), mins % 60),
    duration_minutes: mins,
    is_all_day: false, status: 'upcoming'
  });

  const store = {
    events: [
      /* One event dated TODAY. Without it the calendar opens on the current
         day with "No events on this day", which is honest app behaviour but a
         poor first impression for a demo whose whole point is a full feed. */
      ev(9, 'IMG orientation for first years', 3, 0, 22, 90, 'LHC 201', 'Tech',
         'How the campus web and data systems actually run, and how to join in.'),
      ev(1, 'Inter-Bhawan Football, semis', 13, 1, 16, 120, 'Main Ground', 'Sports', 'Semi-finals of the inter-bhawan football championship.'),
      ev(2, "Cognizance '26 Hackathon", 7, 2, 9, 540, 'MAC', 'Tech', 'Thirty-six hours, any stack, one problem statement. Teams of up to four.'),
      ev(3, 'Thomso Cultural Night', 6, 5, 19, 180, 'Convocation Hall', 'Cultural', 'The headline night of Thomso, with performances from across campus.'),
      ev(4, 'Intro to Systems Design', 2, 7, 17, 90, 'LHC 204', 'Tech,Talks', 'A walk through how large systems are actually put together.'),
      ev(5, 'Open mic night', 8, 9, 18, 120, 'Amphitheatre', 'Cultural', 'Poetry, stand-up and music. Sign-ups on the night.'),
      ev(6, 'MaRS open house', 4, 12, 11, 180, 'Tinkering Lab', 'Tech', 'See what the club has been building and have a go yourself.'),
      ev(7, 'E Cell startup clinic', 9, 14, 15, 120, 'LHC 204', 'Talks', 'Bring an idea, leave with a plan and a mentor.'),
      ev(8, 'Watch Out IITR: photo walk', 12, 16, 18, 150, 'Convocation Hall', 'Talks', 'Open floor. Novices welcome.')
    ],
    academic: [
      { id: 101, title: 'Mid-semester examinations', description: 'Mid-semester examinations for all departments.',
        startDate: iso(inDays(11)).slice(0, 10), endDate: iso(inDays(15)).slice(0, 10), category: 'Exam', isHoliday: false },
      { id: 102, title: 'Independence Day', description: 'Institute holiday.',
        startDate: iso(inDays(3)).slice(0, 10), endDate: iso(inDays(3)).slice(0, 10), category: 'Holiday', isHoliday: true }
    ],
    todos: [
      { id: 1, text: 'Register for Cognizance', notes: 'Team of four, need one more', due_date: iso(inDays(1)).slice(0, 10), due_time: '18:00', completed: false },
      { id: 2, text: 'Book the LHC projector', notes: '', due_date: iso(inDays(4)).slice(0, 10), due_time: '', completed: false },
      { id: 3, text: 'Collect Thomso passes', notes: '', due_date: '', due_time: '', completed: true }
    ],
    reminders: [
      { id: 2, name: "Cognizance '26 Hackathon", tentative_start_time: iso(inDays(2), 9, 0),
        location_name: 'MAC', club_name: 'SDSLabs', offsetsMinutes: [4320, 1440, 120] },
      { id: 3, name: 'Thomso Cultural Night', tentative_start_time: iso(inDays(5), 19, 0),
        location_name: 'Convocation Hall', club_name: 'Cultural Council', offsetsMinutes: [1440, 60] }
    ],
    user: {
      id: 1, name: 'Adbhut Khatri', full_name: 'Adbhut Khatri', email: 'adbhut@ch.iitr.ac.in',
      preferredClubs: [], notPreferredClubs: [],
      preferredCategories: [], notPreferredCategories: []
    },
    nextTodoId: 4
  };

  const ok = body => ({ status: 200, body: JSON.stringify(body ?? {}) });

  function handle(method, path, body) {
    const p = path.replace(/^.*\/mockapi/, '').split('?')[0];
    const data = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};
    const id = () => Number(p.split('/').pop());

    if (p === '/oauth/user') return ok({ userData: store.user, authContext: { permission_names: [] } });

    if (p === '/events/all')   return ok({ events: store.events, currentPage: 1, pageSize: 50, totalEvents: store.events.length, totalPages: 1 });
    if (p === '/events/count') return ok({ count: store.events.length });
    if (/^\/events\/\d+$/.test(p)) return ok({ event: store.events.find(e => e.id === id()) || null });

    if (p.startsWith('/academic-calendar')) return ok(store.academic);
    if (p === '/clubs')                     return ok({ clubs: CLUBS });
    if (p === '/event-categories/all')      return ok({ categories: CATS });
    if (p.startsWith('/locations'))         return ok({ locations: LOCS });
    if (/^\/ingestion\/notices\/\d+$/.test(p))
      return ok({ notice: NOTICES.find(n => n.id === id()) || null });
    if (p.startsWith('/ingestion/notices')) return ok({ notices: NOTICES });

    if (p === '/todos' && method === 'GET')  return ok({ todos: store.todos });
    if (p === '/todos' && method === 'POST') {
      const t = { id: store.nextTodoId++, completed: false, notes: '', due_date: '', due_time: '', ...data };
      store.todos.push(t); return ok({ todo: t });
    }
    if (/^\/todos\/\d+$/.test(p) && (method === 'PATCH' || method === 'PUT')) {
      const t = store.todos.find(x => x.id === id());
      if (t) Object.assign(t, data);
      return ok({ todo: t });
    }
    if (/^\/todos\/\d+$/.test(p) && method === 'DELETE') {
      store.todos = store.todos.filter(x => x.id !== id()); return ok({});
    }

    if (p === '/reminders' && method === 'GET') return ok({ reminders: store.reminders });
    if (/^\/reminders\/\d+$/.test(p)) {
      if (method === 'DELETE') { store.reminders = store.reminders.filter(r => r.id !== id()); return ok({}); }
      const src = store.events.find(e => e.id === id());
      let r = store.reminders.find(x => x.id === id());
      if (!r && src) {
        r = { id: src.id, name: src.name, tentative_start_time: src.tentative_start_time,
              location_name: src.location_name, club_name: src.club_name, offsetsMinutes: [] };
        store.reminders.push(r);
      }
      if (r && Array.isArray(data.offsetsMinutes)) r.offsetsMinutes = data.offsetsMinutes;
      return ok({ reminder: r });
    }

    if (p === '/user/preferences') { Object.assign(store.user, data); return ok({ userData: store.user }); }

    return ok({});
  }

  /* axios talks to XMLHttpRequest, so that is the single place to intercept */
  const Real = window.XMLHttpRequest;
  function MockXHR() {
    this.readyState = 0; this.status = 0; this.response = ''; this.responseText = '';
    this._h = {}; this.onreadystatechange = null; this.onload = null; this.onerror = null;
    this.withCredentials = false; this.timeout = 0;
  }
  MockXHR.prototype.open = function (m, url) { this._m = (m || 'GET').toUpperCase(); this._u = url; this.readyState = 1; };
  MockXHR.prototype.setRequestHeader = function (k, v) { this._h[k] = v; };
  MockXHR.prototype.getAllResponseHeaders = function () { return 'content-type: application/json\r\n'; };
  MockXHR.prototype.getResponseHeader = function (k) { return /content-type/i.test(k) ? 'application/json' : null; };
  MockXHR.prototype.abort = function () {};
  MockXHR.prototype.addEventListener = function (t, fn) { this['on' + t] = fn; };
  MockXHR.prototype.removeEventListener = function () {};
  MockXHR.prototype.send = function (body) {
    const url = String(this._u || '');
    if (!/\/mockapi/.test(url)) {                       // let anything else through
      const real = new Real();
      real.open(this._m, url, true);
      Object.entries(this._h).forEach(([k, v]) => real.setRequestHeader(k, v));
      real.onload = () => {
        this.status = real.status; this.responseText = real.responseText;
        this.response = real.response; this.readyState = 4;
        this.onreadystatechange && this.onreadystatechange(); this.onload && this.onload();
      };
      real.onerror = () => { this.onerror && this.onerror(new Error('network')); };
      return real.send(body);
    }
    const res = handle(this._m, url, body);
    setTimeout(() => {
      this.status = res.status; this.responseText = res.body; this.response = res.body;
      this.readyState = 4;
      this.onreadystatechange && this.onreadystatechange();
      this.onload && this.onload();
    }, 60);                                             // a beat, so loading states are visible
  };
  window.XMLHttpRequest = MockXHR;

  /* the demo runs inside an iframe; a service worker would only get in the way */
  if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('demo'));

  /* Boot straight onto the feed.
     The app uses BrowserRouter, and a static host cannot serve /demo/home as a
     file. Rewriting the path here — before React mounts — means the only URL
     ever requested is /demo/, while the router still starts on the feed.
     Everything after this is pushState, so no further requests are made. */
  try {
    const base = location.pathname.replace(/index\.html$/, '');
    if (!/\/(home|calendar|todo|profile|notifications|event|notices)/.test(location.pathname)) {
      history.replaceState({}, '', base.replace(/\/$/, '') + '/home');
    }
  } catch {}
})();
