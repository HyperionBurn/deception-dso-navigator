// Documentation preset for @workhub/voice-kit consistency. It describes the
// PRODUCTION agent (already provisioned as agent_0101m86hthvjfm6vqeymg81may5e) —
// it is never passed to kit.ensureAgent, which creates or overwrites agents.
// api/token.mjs maps preset names to pinned agent ids instead.
import { definePreset } from '@workhub/voice-kit/presets';
import { defineClientTool } from '@workhub/voice-kit/tools';
import { handoverTool, researchTool } from '@workhub/voice-kit/presets';

// Server-side webhook on the real agent; declared here as a client spec so the
// preset documents the full tool surface in kit format.
export const nextRouteStep = defineClientTool({
  name: 'next_route_step',
  description:
    'Get one checked English instruction for the MangoBot operator. Use only after they ' +
    'explicitly confirm the robot is stopped and report the actual landmark and orientation. ' +
    'No physical control. Never submit a guessed landmark, ID or orientation.',
  params: {
    destination_id: {
      type: 'string',
      description: 'The confirmed course destination.',
      enum: ['meeting_room', 'conference_room', 'call_booth_1', 'call_booth_2',
        'call_booth_3', 'call_booth_4', 'team_tables', 'kitchen'],
    },
    current_landmark: {
      type: 'string', optional: true,
      description: 'Exact landmark label the operator explicitly reports.',
    },
    current_id: {
      type: 'string', optional: true,
      description: 'Previously resolved checked anchor ID at the robot\'s confirmed location.',
    },
    heading: {
      type: 'string', optional: true, enum: ['north', 'east', 'south', 'west'],
      description: 'Operator\'s confirmed compass heading.',
    },
    facing: {
      type: 'string', optional: true,
      description: 'Checked landmark the operator reports facing.',
    },
  },
  timeoutSecs: 6,
});

export const deceptionNavigator = definePreset({
  id: 'deception-navigator',
  name: 'Deception | DSO AI Voice Navigator',
  description:
    'Trilingual (EN/AR/HI) robot navigator: the operator confirms every step on a checked ' +
    'floor map; the agent never guesses positions and hands unclear cases to a human.',
  languages: ['en', 'ar', 'hi'],
  greeting: 'أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I\'m an AI robot guide. Where would you like to go?',
  firstMessage: {
    en: 'Hi, I\'m an AI robot guide. Where would you like to go?',
    ar: 'أهلًا، أنا دليل آلي بالذكاء الاصطناعي. وين حاب تروح؟',
    hi: 'नमस्ते, मैं एक AI रोबोट गाइड हूँ। आप कहाँ जाना चाहेंगे?',
  },
  systemPrompt:
    'You are the voice of the MangoBot guide robot at Dubai Silicon Oasis. Operators move the ' +
    'robot on your instructions: every route step comes from next_route_step, which only ' +
    'returns checked floor-map instructions. Ask the operator to report the taped sign they ' +
    'see and what it faces before requesting a step. Prefix operator instructions with ' +
    '"Operator," and translate them from the visitor\'s language. On a destination change, ' +
    'tell the operator to stop before re-planning. You cannot move the robot yourself.',
  knowledge: [
    'Floor positions are taped letter signs (A, B, C…) and destination signs.',
    'The route tool only knows checked landmarks; unmatched reports return hold statuses.',
  ],
  tools: [nextRouteStep, researchTool, handoverTool],
  llm: 'deepseek-v41-flash',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  maxDurationSeconds: 300,
});
