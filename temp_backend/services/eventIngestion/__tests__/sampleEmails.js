/**
 * Realistic sample broadcasts for the dev-seed endpoint, so the UI has real
 * pipeline-produced events + notices to show. Trimmed from real IITR mail;
 * future-dated (2026) so events land in the upcoming feed.
 */
const SN = 'students-notices@iitr.ac.in';
module.exports = [
    { message_id: 's1', from: 'Cinema Club <cinemaclub@iitr.ac.in>', to: SN,
      subject: 'Cinema Club Screening : Main Vaapas Aaunga',
      body_text: 'Cinema Club presents a screening on August 18, 2026 at 9:00 PM. Venue : Convocation Hall. All are welcome.' },
    { message_id: 's2', from: 'Head Management Studies <head@ms.iitr.ac.in>', to: SN,
      subject: 'Special Lecture by Sh Ashok Kumar (Ex-DGP) at APJ 103',
      body_text: 'All are welcome to attend the Guest Lecture. The session is on August 20, 2026 at 10 am at APJ 103.' },
    { message_id: 's3', from: 'Coordinator FIM <fitindia@iitr.ac.in>', to: SN,
      subject: 'Uttaranchal State Triathlon Championship 2026',
      body_text: 'The Institute Sports Council is organizing the Triathlon on August 27, 2026. It will commence at 7:00 AM.' },
    { message_id: 's4', from: 'Himalayan ExplorersClub <hec@iitr.ac.in>', to: SN,
      subject: 'Parashar Lake Trek',
      body_text: 'Join us for the Parashar Lake Trek departing on September 12, 2026. Registration link https://forms.gle/abc123' },
    { message_id: 's5', from: 'Cognizance IIT Roorkee <cognizance@iitr.ac.in>', to: SN,
      subject: 'HiLabs Agentic AI Hackathon || Cognizance 2026',
      body_text: 'Join us for the HiLabs Agentic AI Hackathon on September 9, 2026. Register at https://unstop.com/hackathon' },
    { message_id: 's6', from: 'Corporate Interactions Group <cig@iitr.ac.in>', to: SN,
      subject: 'Breaking into Product Management: Masterclass with Industry Experts',
      body_text: 'You are invited to a masterclass on August 30, 2026 at 6:00 PM. Online session, register here https://forms.gle/pm' },
    { message_id: 's7', from: 'awards <awards@iitr.ac.in>', to: SN,
      subject: 'Kalpana Chawla Chhatravrati Yojna (Girls Only)',
      body_text: 'Dear Students, please find attached the poster for the Kalpana Chawla Chhatravrati Yojna for Engineering Students (Girls Only). The detailed guidelines for the scholarship are available at https://dst.highereduhry.ac.in/KCCY. Students may apply through https://harchhatravratti.highereduhry.ac.in. For any queries, write to kccy.scholarship@gmail.com.' },
    { message_id: 's8', from: 'Assoc.Dean Of Student Wellness <adoswsw@iitr.ac.in>', to: SN,
      subject: 'Financial Assistance for Needy UG Students',
      body_text: 'On behalf of the Wellness Centre, financial assistance is announced for needy undergraduate students whose annual family income is below Rs 8,00,000. The maximum assistance is Rs 1,00,000 per student per academic year, usable only towards the Institute semester fee. Eligible students may apply via the Google Form https://forms.gle/DkLHTSeJz8CfaAY67. The last date to apply is August 20, 2026.' },
    { message_id: 's9', from: 'UG AAO <aao-ug@iitr.ac.in>', to: SN,
      subject: 'Notification: Fee Payment for Autumn Semester 2026-27',
      body_text: 'The notification regarding Fee Payment for the Autumn Semester 2026-27 is available on Channel-i at https://channeli.in/noticeboard/notice/20082. Students are requested to complete the payment within the schedule to avoid a late fine.' },
    { message_id: 's10', from: 'Institute CentralLibrary <library@iitr.ac.in>', to: SN,
      subject: 'Bloomberg Terminal Access now available',
      body_text: 'The Bloomberg Terminal is now available for students at the Mahatma Gandhi Central Library. Access is on a first-come, first-served basis during library hours. Students may use it for financial data, analytics and research.' },
    { message_id: 's11', from: 'Chairman Institute Sports Council <chairman.isc@iitr.ac.in>', to: SN,
      subject: 'Closure of football field for maintenance',
      body_text: 'The football ground is closed until further notice for maintenance, surface levelling, and grass restoration work. We regret the inconvenience caused and request your cooperation. For any queries, please contact the Assistant Sports Officer.' },
    { message_id: 's12', from: 'Head Chemistry <head@cy.iitr.ac.in>', to: SN,
      subject: 'Open Notice for Ph.D. Viva-Voce Examination of Mr. X',
      body_text: 'Viva-voce scheduled.' },
];
