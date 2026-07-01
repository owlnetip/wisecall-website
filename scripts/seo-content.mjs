export const site = {
  name: 'WiseCall',
  url: 'https://wisecall.io',
  description:
    'WiseCall is an AI receptionist and AI voice agent platform for UK businesses. It answers calls, qualifies enquiries, books appointments, captures details and supports teams out of hours.',
  email: 'info@wisecall.io',
  logo: '/owl-logo.png',
  ogImage: '/og-image.jpg',
};

export const trustSignals = [
  'UK-based setup and support',
  'GDPR-aware call handling',
  'Complete phone system included',
  'Call summaries and transcripts',
  'Designed for UK service businesses',
];

export const integrations = [
  {
    name: 'Calendars',
    description: 'Connect WiseCall to appointment availability, callback slots and booking workflows.',
  },
  {
    name: 'CRMs and case systems',
    description: 'Send structured caller details, summaries and next actions to the systems your team already uses.',
  },
  {
    name: 'VoIP and phone systems',
    description: 'Use WiseCall with business numbers, routing rules, extensions and escalation paths.',
  },
  {
    name: 'Email and team alerts',
    description: 'Deliver call outcomes to the right inbox, team channel or manager without manual note-taking.',
  },
];

export const globalFaqs = [
  {
    question: 'What is an AI receptionist?',
    answer:
      'An AI receptionist is a voice agent that answers phone calls in your business name, understands the caller’s request, asks follow-up questions, captures details and routes the next step to your team. WiseCall is built for UK businesses that want professional call handling without relying only on voicemail or missed-call callbacks.',
  },
  {
    question: 'Does WiseCall replace our phone system?',
    answer:
      'WiseCall can work as part of a complete business communications setup. Every WiseCall plan includes the AI receptionist and a phone system foundation, including business numbers, routing, extensions and call handling configuration.',
  },
  {
    question: 'Can WiseCall handle out-of-hours calls?',
    answer:
      'Yes. WiseCall can answer out-of-hours calls, capture the caller’s details, identify urgency, offer a callback or booking route, and send a structured summary to your team before the next working day.',
  },
  {
    question: 'Is WiseCall suitable for small UK businesses?',
    answer:
      'Yes. WiseCall is designed for UK service businesses where missed calls can mean lost enquiries, delayed bookings or poor client experience. It is especially useful for teams that cannot justify extra reception headcount but still need consistent call cover.',
  },
];

export const industries = [
  {
    slug: 'dental',
    legacyPath: '/dental.html',
    name: 'Dental Practices',
    singular: 'dental practice',
    audience: 'practice owners, practice managers and reception teams',
    keyword: 'AI receptionist for dental practices',
    title: 'AI Receptionist for Dental Practices UK | WiseCall',
    description:
      'WiseCall helps UK dental practices answer patient calls, capture new patient enquiries, manage cancellations and support reception teams around the clock.',
    h1: 'AI Receptionist for Dental Practices',
    heroLead:
      'WiseCall answers patient calls, captures new enquiries, supports cancellations and helps your reception team stay focused on the patients in front of them.',
    painTitle: 'How Many Patient Calls Is Your Practice Missing?',
    pain:
      'Dental reception teams are often answering phones while checking in patients, handling treatment queries and filling gaps in the diary. New patient enquiries and cancellation calls are easy to miss at exactly the moments they matter most.',
    primaryOutcome: 'More captured patient enquiries',
    leadType: 'patient enquiry',
    missedCallExample:
      'A new patient calls after work to ask about availability. WiseCall captures the reason for calling, contact details and appointment preference, then sends the summary to your team.',
    integrations: ['Dentally', 'Exact', 'SOE', 'Google Calendar', 'Microsoft 365'],
    compliance:
      'WiseCall is designed with GDPR-aware call handling. Patient data workflows should be reviewed against your practice policies before launch.',
    features: [
      'New patient enquiry capture',
      'Cancellation and callback workflows',
      'Emergency call triage rules',
      'Out-of-hours call summaries',
      'Diary and reception support',
      'Reception overflow handling',
    ],
    faqs: [
      {
        question: 'Can WiseCall book dental appointments automatically?',
        answer:
          'WiseCall can support dental appointment booking workflows where the practice’s calendar or diary process allows it. It can capture the patient’s reason for calling, preferred times and contact details, then either offer available slots or pass a structured booking request to the reception team.',
      },
      {
        question: 'How does WiseCall handle emergency dental calls?',
        answer:
          'WiseCall can ask emergency triage questions agreed with the practice, identify urgent symptoms or pain-related calls, and escalate the call or summary according to the practice’s rules. It should not replace clinical judgement, but it can help urgent calls avoid voicemail.',
      },
      {
        question: 'Can WiseCall help with dental cancellations?',
        answer:
          'Yes. WiseCall can capture cancellation requests, record the appointment details, ask whether the patient wants to rebook, and notify the practice team quickly so the gap can be managed.',
      },
      {
        question: 'Does WiseCall work when reception is busy?',
        answer:
          'Yes. WiseCall can be configured to answer overflow calls when reception is busy, capture the enquiry and send the team a clear summary instead of letting the call go unanswered.',
      },
    ],
  },
  {
    slug: 'legal',
    legacyPath: '/legal.html',
    name: 'Legal and Professional Services',
    singular: 'law firm',
    audience: 'partners, practice managers and client intake teams',
    keyword: 'AI receptionist for law firms',
    title: 'AI Receptionist for Law Firms UK | WiseCall',
    description:
      'WiseCall helps UK law firms answer new client enquiries, qualify caller details, capture matter information and support out-of-hours legal intake.',
    h1: 'AI Receptionist for Law Firms',
    heroLead:
      'WiseCall answers calls professionally, captures matter details and helps your team respond to new client enquiries without relying on voicemail.',
    painTitle: 'How Many New Client Enquiries Are Being Missed?',
    pain:
      'Legal calls often arrive when fee earners are in meetings, reception is handling other clients or the office is closed. A missed call can mean a potential matter goes to another firm.',
    primaryOutcome: 'More structured client intake',
    leadType: 'new client enquiry',
    missedCallExample:
      'A potential client calls about a conveyancing, family or employment matter. WiseCall captures the matter type, urgency, contact details and preferred callback window.',
    integrations: ['Clio', 'LEAP', 'Actionstep', 'Microsoft 365', 'Google Workspace'],
    compliance:
      'WiseCall can support consistent intake questions and audit trails. Law firms should configure escalation and confidentiality workflows around their own SRA and data-protection obligations.',
    features: [
      'Initial matter detail capture',
      'Practice-area routing',
      'Urgent call escalation',
      'Out-of-hours intake',
      'Structured call summaries',
      'Callback booking workflows',
    ],
    faqs: [
      {
        question: 'Can WiseCall conduct initial client intake for a law firm?',
        answer:
          'Yes. WiseCall can ask agreed intake questions, capture the caller’s contact details, matter type, urgency and preferred next step, then send a structured summary to the relevant legal team.',
      },
      {
        question: 'Does WiseCall give legal advice?',
        answer:
          'No. WiseCall should not give legal advice. It is used to answer calls, capture information, route urgent issues and help the firm respond faster while legal advice remains with qualified professionals.',
      },
      {
        question: 'Can WiseCall route calls by practice area?',
        answer:
          'Yes. WiseCall can identify the caller’s matter type, such as conveyancing, family, employment or commercial, and route the summary or escalation to the relevant person or team.',
      },
      {
        question: 'Is WiseCall useful for small high-street law firms?',
        answer:
          'Yes. WiseCall is suitable for smaller firms that need consistent intake cover but do not want every new enquiry to depend on one receptionist or a voicemail callback.',
      },
    ],
  },
  {
    slug: 'estate-agents',
    legacyPath: '/property.html',
    name: 'Estate Agents',
    singular: 'estate agency',
    audience: 'estate agency owners, branch managers and negotiators',
    keyword: 'AI receptionist for estate agents',
    title: 'AI Receptionist for Estate Agents UK | WiseCall',
    description:
      'WiseCall helps estate agents capture valuation requests, viewing enquiries and landlord calls when branch teams are busy or out of hours.',
    h1: 'AI Receptionist for Estate Agents',
    heroLead:
      'WiseCall answers property enquiries, captures viewing requests and helps your branch team respond quickly to sellers, landlords, buyers and tenants.',
    painTitle: 'How Many Valuations and Viewing Requests Are You Missing?',
    pain:
      'Property enquiries are time-sensitive. If a buyer, landlord or seller calls after hours or while negotiators are out on viewings, the next call may be to another agent.',
    primaryOutcome: 'More captured property enquiries',
    leadType: 'valuation or viewing enquiry',
    missedCallExample:
      'A landlord calls after branch hours to ask about letting a property. WiseCall captures the property details, location, timescale and preferred callback slot.',
    integrations: ['Reapit', 'Alto', 'Dezrez', 'Street.co.uk', 'Google Calendar'],
    compliance:
      'WiseCall supports consistent data capture and escalation. Property teams should configure branch routing and tenant/landlord escalation rules before launch.',
    features: [
      'Valuation request capture',
      'Viewing enquiry handling',
      'Landlord and seller call summaries',
      'Branch overflow support',
      'Out-of-hours enquiry capture',
      'Callback and appointment routing',
    ],
    faqs: [
      {
        question: 'Can WiseCall capture valuation requests for estate agents?',
        answer:
          'Yes. WiseCall can capture the caller’s property address, ownership status, reason for valuation, timescale and preferred callback window, then send a structured valuation lead to the branch team.',
      },
      {
        question: 'Can WiseCall handle viewing enquiries out of hours?',
        answer:
          'Yes. WiseCall can answer out-of-hours viewing enquiries, collect the property reference, buyer or tenant details and preferred viewing times, then notify the branch for follow-up.',
      },
      {
        question: 'Does WiseCall replace negotiators?',
        answer:
          'No. WiseCall supports negotiators by capturing details and reducing missed calls. Relationship-led sales, valuations and negotiations remain with your team.',
      },
      {
        question: 'Can WiseCall support lettings and sales teams?',
        answer:
          'Yes. WiseCall can be configured with different questions and routing rules for sales, lettings, property management and landlord enquiries.',
      },
    ],
  },
  {
    slug: 'care-homes',
    legacyPath: null,
    name: 'Care Homes',
    singular: 'care home',
    audience: 'care home owners, registered managers and admin teams',
    keyword: 'AI receptionist for care homes',
    title: 'AI Receptionist for Care Homes UK | WiseCall',
    description:
      'WiseCall helps UK care homes answer family enquiries, capture caller details, support out-of-hours call routing and reduce pressure on busy admin teams.',
    h1: 'AI Receptionist for Care Homes',
    heroLead:
      'WiseCall answers calls professionally, captures family and supplier enquiries, and helps care home teams route urgent calls without relying only on voicemail.',
    painTitle: 'How Many Important Care Home Calls Are Being Missed?',
    pain:
      'Care home teams are often supporting residents, relatives, staff and suppliers at the same time. When phones are busy or calls arrive out of hours, important family enquiries, staffing calls or urgent messages can be missed or delayed.',
    primaryOutcome: 'More consistent care home call handling',
    leadType: 'family or care home enquiry',
    missedCallExample:
      'A family member calls to ask about availability, visiting arrangements or a resident-related concern. WiseCall captures the caller’s details, reason for calling, urgency and preferred callback route.',
    integrations: ['On-call rota', 'Email alerts', 'Microsoft 365', 'Google Calendar', 'Care planning handover workflow'],
    compliance:
      'WiseCall can support consistent call capture and escalation, but it should be configured around the care home’s safeguarding, emergency, confidentiality and CQC-related procedures. It should not replace clinical judgement, safeguarding leads or emergency services.',
    features: [
      'Family enquiry capture',
      'Out-of-hours call summaries',
      'Urgent call escalation rules',
      'Staffing and supplier message capture',
      'Visiting and availability enquiry support',
      'Admin team overflow handling',
    ],
    faqs: [
      {
        question: 'Can WiseCall answer calls for a care home out of hours?',
        answer:
          'Yes. WiseCall can answer out-of-hours calls for a care home, capture the caller’s details, identify the reason for the call and follow agreed routing rules for urgent messages, callbacks or escalation.',
      },
      {
        question: 'Can WiseCall handle urgent or safeguarding-related care home calls?',
        answer:
          'WiseCall can be configured to recognise urgent or safeguarding-related language and escalate according to the care home’s approved rules. It should not make clinical or safeguarding decisions; those remain with the care home’s responsible people and emergency services where appropriate.',
      },
      {
        question: 'Can WiseCall help with family enquiries about care home availability?',
        answer:
          'Yes. WiseCall can capture a family member’s name, contact details, preferred location, type of care being discussed and callback preference, then send a structured enquiry summary to the care home team.',
      },
      {
        question: 'Is WiseCall suitable for care homes with busy admin teams?',
        answer:
          'Yes. WiseCall is suitable for care homes where admin teams are often handling visitors, relatives, staff and suppliers at the same time. It can answer overflow calls and send clear summaries so fewer enquiries are lost.',
      },
    ],
  },
];

export const futureIndustries = [
  'restaurants',
  'schools',
  'telecoms-reseller',
];

export const comparisonRows = [
  ['Availability', '24/7 AI call answering', 'Business-hours team coverage', 'Variable depending on staffing'],
  ['Call summaries', 'Structured summaries and transcripts', 'Manual notes or messages', 'Usually voicemail transcription only'],
  ['Phone system', 'Included with WiseCall plans', 'Usually separate', 'Usually separate'],
  ['Scaling', 'Handles overflow without extra reception headcount', 'Requires more people', 'Limited by callback capacity'],
  ['Best fit', 'UK businesses needing consistent call capture', 'Teams wanting fully human reception', 'Low-volume businesses using voicemail'],
];

export const comparisonPages = [
  {
    slug: 'wisecall-vs-voicemail',
    keyword: 'voicemail alternative',
    title: 'WiseCall vs Voicemail | AI Receptionist Alternative to Voicemail UK',
    description:
      'Most callers hang up rather than leave a voicemail. See what changes for a UK business when WiseCall answers instead of a recorded message.',
    eyebrow: 'Comparison',
    h1: 'WiseCall vs <span class="text-[#7de8eb]">Voicemail</span>',
    lead: 'Voicemail depends on the caller leaving a message and someone finding time to listen to it. WiseCall answers the call.',
    subject: 'Voicemail',
    columns: ['What happens', 'WiseCall', 'Voicemail'],
    rows: [
      ['When the phone isn’t answered', 'WiseCall answers immediately, every time', 'The caller hears a recorded message and has to leave one'],
      ['Caller behaviour', 'The caller speaks to an agent and gets a real answer', 'Most callers hang up rather than leave a message'],
      ['Information captured', 'Structured details: name, reason, urgency, contact, next step', 'Whatever the caller manages to say in one message, if they leave one'],
      ['Follow-up speed', 'A summary and next step reach your team immediately', 'Depends on when someone next checks messages'],
      ['Urgent calls', 'Can escalate to a human straight away, based on your rules', 'Sits in the same queue as everything else'],
      ['Caller experience', 'Feels like a proper answer from your business', 'Feels like being brushed off'],
    ],
    faqs: [
      { question: 'Is an AI receptionist better than voicemail?', answer: 'For most UK businesses, yes. An AI receptionist answers immediately, asks questions and captures structured details, while voicemail depends on the caller being willing to leave a message and someone finding time to act on it.' },
      { question: 'Do people actually leave voicemails?', answer: 'Far fewer than businesses expect. Most callers who reach voicemail simply hang up and either try again later, call a competitor, or give up. WiseCall answers before that decision has to be made.' },
      { question: 'Will callers know they are talking to AI?', answer: 'WiseCall answers in your business name and can be configured to be upfront about being an AI assistant if you want it to be. The priority is a fast, useful answer rather than pretending to be something it is not.' },
      { question: 'What happens if WiseCall cannot help with a call?', answer: 'WiseCall follows your business-approved escalation rules — it can offer a callback, take a detailed message, or route urgent calls to a human, so a call that voicemail would have lost still gets a proper next step.' },
    ],
    ctaTitle: 'Stop losing callers to voicemail',
    ctaText: 'Start a 7-day pilot and see what WiseCall would have captured from the calls voicemail is currently losing.',
  },
  {
    slug: 'wisecall-vs-answering-service',
    keyword: 'AI receptionist vs answering service',
    title: 'WiseCall vs Answering Service | AI Receptionist vs Human Call Answering UK',
    description:
      'Compare WiseCall’s AI receptionist with traditional human answering services on availability, cost, consistency and the detail captured on every call.',
    eyebrow: 'Comparison',
    h1: 'WiseCall vs <span class="text-[#7de8eb]">Answering Service</span>',
    lead: 'Traditional answering services take a message. WiseCall answers, asks the right questions, and hands your team a structured summary.',
    subject: 'Answering service',
    columns: ['What matters', 'WiseCall', 'Traditional answering service'],
    rows: [
      ['Availability', '24/7, no shift gaps', 'Usually business hours, or evenings and weekends at a premium'],
      ['Cost model', 'A fixed monthly plan with a clear call allowance', 'Often billed per minute or per call, harder to predict'],
      ['Consistency', 'Follows the same approved script and questions every call', 'Depends on which operator picks up'],
      ['Detail captured', 'Structured fields: reason, urgency, contact, next step', 'A free-text message, quality varies by operator'],
      ['Escalation', 'Follows your rules automatically, every time', 'Depends on the operator recognising urgency'],
      ['Setup time', 'Live in days', 'Often weeks of scripting and operator training'],
      ['Genuinely complex calls', 'Escalates to your team rather than improvising', 'A live human voice, which can be an advantage for nuanced conversations'],
    ],
    faqs: [
      { question: 'Is an AI receptionist as good as a human answering service?', answer: 'For structured, repeatable calls — enquiries, bookings, out-of-hours messages — WiseCall is faster, more consistent and captures more usable detail. For a genuinely nuanced or sensitive conversation, a human is still better; WiseCall is built to recognise that and escalate rather than improvise.' },
      { question: 'What happens with a call WiseCall cannot handle?', answer: 'WiseCall follows business-approved escalation rules: it can transfer to a person, offer a callback, or take a detailed message and flag it as urgent, so difficult calls still get a proper next step instead of a generic message.' },
      { question: 'Is WiseCall cheaper than an answering service?', answer: 'WiseCall plans are a fixed monthly price with a clear call allowance, which is usually more predictable than per-minute or per-call answering service billing, especially once call volume grows.' },
      { question: 'Can WiseCall sound like our business, not a generic AI voice?', answer: 'Yes. WiseCall answers in your business name using a greeting and call rules you approve, rather than a shared generic script used across many unrelated businesses.' },
    ],
    ctaTitle: 'Try it on real calls before you decide',
    ctaText: 'Start a 7-day pilot and compare what WiseCall captures against your current answering service, side by side.',
  },
];

export const blogPosts = [
  {
    slug: 'missed-calls-cost-uk-businesses',
    title: 'What Missed Calls Cost UK Businesses',
    description:
      'A practical guide to estimating the cost of missed calls for UK service businesses, with examples for dental practices, law firms and estate agents.',
    date: '2026-05-18',
    author: 'WiseCall',
    topic: 'Missed call recovery',
  },
];

export const trackingTodos = [
  'Add Google Search Console verification token in production once the property is created.',
  'Add Bing Webmaster Tools verification token once the Bing property is created.',
  'Add GA4 measurement ID through an environment variable or deployment setting, not a fake hardcoded ID.',
  'Track demo booking clicks and successful form submissions as conversion events.',
  'Track call source and landing page source through hidden form fields and CRM fields.',
];
