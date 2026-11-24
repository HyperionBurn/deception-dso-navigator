// Facts about the Voice of the Oasis event, answered by research_fact before
// the voice-kit facts and the hosted researcher. Every answer is copied from
// the organisers' guides in docs/organisers/ (24 Nov 2026); nothing is added.
const GUIDE = 'Voice of the Oasis Team Guide v2, 24-25 Nov 2026';
const UPDATE = 'Voice of the Oasis Team Guide Update, 24 Nov 2026';

export const EVENT_FACTS = Object.freeze([
  {
    question: 'What is the Voice of the Oasis hackathon?',
    answer: 'Voice of the Oasis is a 24-hour hackathon at Dtec in Dubai Silicon Oasis on 24 and 25 November 2026, where twelve teams build voice agents for three challenges.',
    sources: [`${GUIDE}, page 1`],
  },
  {
    question: 'Who organises the Voice of the Oasis hackathon?',
    answer: 'It is organised by Zero One Hundred, RoboHours with PhysicalAiData, and The Doers Company, with ElevenLabs as the technology partner.',
    sources: [`${GUIDE}, pages 2 and 4`],
  },
  {
    question: 'What are the three hackathon challenges?',
    answer: 'The three challenges are the AI Voice Navigator on robot A, the Soft Landing Guide for founders, and the HALA Concierge on robot B.',
    sources: [`${GUIDE}, page 3`],
  },
  {
    question: 'When do the hackathon pitches start?',
    answer: 'Pitches to the jury start at 8:45 on Wednesday 25 November, after the code freeze at 8:30.',
    sources: [`${GUIDE}, page 2`],
  },
  {
    question: 'When are the hackathon winners announced?',
    answer: 'The winners are announced at 10:45 on Wednesday 25 November and go on the Doers Summit main stage at 1 pm.',
    sources: [`${GUIDE}, page 2`],
  },
  {
    question: 'Who is on the hackathon jury?',
    answer: 'The jury is Abdelkarim Deesi of Dubai Future Foundation, George Shayeb of ElevenLabs, Krzysztof Szczurek of Nucleus Robotics, Brandon Moses of Panthera Robotics, Adam Seruga of RoboHours and Ali Shaheen of Palgu.',
    sources: [`${GUIDE}, page 9`],
  },
  {
    question: 'What are the hackathon prizes?',
    answer: 'ElevenLabs gives each member of the three winning teams three months of its Pro tier, and the best ElevenLabs build gets three months of its Scale tier.',
    sources: [`${GUIDE}, page 4`],
  },
  {
    question: 'What robot is this and who makes it?',
    answer: 'This is an AgiBot X2 Ultra humanoid from MangoBot. A MangoBot operator controls all its movement; I only give directions.',
    sources: [`${GUIDE}, page 5`, `${UPDATE}, page 2`],
  },
  {
    question: 'Who moves or controls the robot?',
    answer: 'A MangoBot operator walks the robot. I am the voice: I tell the operator the way, and the operator does all the moving.',
    sources: [`${UPDATE}, page 2`],
  },
  {
    question: 'Where can I get the WiFi details?',
    answer: 'The WiFi details are given at registration.',
    sources: [`${GUIDE}, page 2`],
  },
  {
    question: 'Who can I ask about the hackathon or find an organiser?',
    answer: 'Find Adam or Seruga in the room, or ask at registration.',
    sources: [`${UPDATE}, page 1`],
  },
  {
    question: 'What is HADI?',
    answer: 'HADI is the AI text chatbot of Dubai Silicon Oasis; it covered 226 smart services by 2020, when the authority reported 95 percent of its services digitised.',
    sources: [`${GUIDE}, page 8`],
  },
].map(Object.freeze));
