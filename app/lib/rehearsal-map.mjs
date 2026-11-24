// Voice of the Oasis — REHEARSAL floor map. Entirely fictional: no record here
// was walked, checked, or taped on a real floor. api/route.mjs serves this map
// only when NAVIGATOR_MAP_VARIANT=rehearsal; production keeps using FLOOR_MAP.
//
// Fictional hall: letter signs A–F on a spine, destinations hanging off them.
//        sign D -- meeting_room, conference_room
//       /      \
// sign A -- sign B -- call_booth_1, call_booth_2          sign F (waypoint)
//       \
//        sign C -- kitchen, team_tables -- sign E -- call_booth_3, call_booth_4
export const REHEARSAL_MAP = {
  survey: {
    checked_at: 'not walked — fictional rehearsal data',
    checked_by: 'rehearsal fixture',
    reference: 'app/lib/rehearsal-map.mjs',
  },
  start: { anchor: 'sign_a', facing: 'stage' },
  anchors: [
    {
      id: 'sign_a', landmark: 'sign A',
      aliases: ['letter A', 'first sign', 'entrance sign', 'اللافتة أ'],
    },
    {
      id: 'sign_b', landmark: 'sign B',
      aliases: ['letter B', 'second sign', 'اللافتة ب'],
    },
    {
      id: 'sign_c', landmark: 'sign C',
      aliases: ['letter C', 'third sign', 'اللافتة ج'],
    },
    {
      id: 'sign_d', landmark: 'sign D',
      aliases: ['letter D', 'fourth sign', 'اللافتة د'],
    },
    {
      id: 'sign_e', landmark: 'sign E',
      aliases: ['letter E', 'fifth sign', 'اللافتة إي'],
    },
    {
      id: 'sign_f', landmark: 'sign F',
      aliases: ['letter F', 'sixth sign', 'اللافتة إف'],
    },
    {
      id: 'meeting_room', landmark: 'meeting room sign',
      aliases: ['meeting room', 'the meeting room', 'قاعة الاجتماعات'],
    },
    {
      id: 'conference_room', landmark: 'conference room sign',
      aliases: ['conference room', 'the conference room', 'قاعة المؤتمرات'],
    },
    {
      id: 'call_booth_1', landmark: 'call booth 1 sign',
      aliases: ['booth one', 'first booth', 'booth 1', 'الكابينة الأولى'],
    },
    {
      id: 'call_booth_2', landmark: 'call booth 2 sign',
      aliases: ['booth two', 'second booth', 'booth 2', 'الكابينة الثانية'],
    },
    {
      id: 'call_booth_3', landmark: 'call booth 3 sign',
      aliases: ['booth three', 'third booth', 'booth 3', 'الكابينة الثالثة'],
    },
    {
      id: 'call_booth_4', landmark: 'call booth 4 sign',
      aliases: ['booth four', 'fourth booth', 'booth 4', 'الكابينة الرابعة'],
    },
    {
      id: 'team_tables', landmark: 'team tables sign',
      aliases: ['team tables', 'the tables', 'طاولات الفريق'],
    },
    {
      id: 'kitchen', landmark: 'kitchen sign',
      aliases: ['kitchen', 'the kitchen', 'المطبخ'],
    },
  ],
  edges: [
    // Spine A <-> B, A <-> C
    { from: 'sign_a', to: 'sign_b', action: 'left_then_straight', entry_pose: { facing: 'stage' }, exit_pose: { facing: 'booths' } },
    { from: 'sign_b', to: 'sign_a', action: 'right_then_straight', entry_pose: { facing: 'booths' }, exit_pose: { facing: 'stage' } },
    { from: 'sign_a', to: 'sign_c', action: 'right_then_straight', entry_pose: { facing: 'stage' }, exit_pose: { facing: 'tables' } },
    { from: 'sign_c', to: 'sign_a', action: 'left_then_straight', entry_pose: { facing: 'tables' }, exit_pose: { facing: 'stage' } },
    // Spine B <-> D, C <-> E
    { from: 'sign_b', to: 'sign_d', action: 'walk_straight', entry_pose: { facing: 'booths' }, exit_pose: { facing: 'hall' } },
    { from: 'sign_d', to: 'sign_b', action: 'around_then_straight', entry_pose: { facing: 'hall' }, exit_pose: { facing: 'booths' } },
    { from: 'sign_c', to: 'sign_e', action: 'walk_straight', entry_pose: { facing: 'tables' }, exit_pose: { facing: 'windows' } },
    { from: 'sign_e', to: 'sign_c', action: 'around_then_straight', entry_pose: { facing: 'windows' }, exit_pose: { facing: 'tables' } },
    // Dead-end waypoint F off D
    { from: 'sign_d', to: 'sign_f', action: 'left_then_straight', entry_pose: { facing: 'hall' }, exit_pose: { facing: 'garden' } },
    { from: 'sign_f', to: 'sign_d', action: 'right_then_straight', entry_pose: { facing: 'garden' }, exit_pose: { facing: 'hall' } },
    // Destinations off B
    { from: 'sign_b', to: 'call_booth_1', action: 'approach_visible', entry_pose: null, exit_pose: null },
    { from: 'call_booth_1', to: 'sign_b', action: 'around_then_straight', entry_pose: { facing: 'booths' }, exit_pose: { facing: 'booths' } },
    { from: 'sign_b', to: 'call_booth_2', action: 'left_then_straight', entry_pose: { facing: 'booths' }, exit_pose: { facing: 'booths' } },
    { from: 'call_booth_2', to: 'sign_b', action: 'right_then_straight', entry_pose: { facing: 'booths' }, exit_pose: { facing: 'booths' } },
    // Destinations off D
    { from: 'sign_d', to: 'meeting_room', action: 'approach_visible', entry_pose: null, exit_pose: null },
    { from: 'meeting_room', to: 'sign_d', action: 'around_then_straight', entry_pose: { facing: 'hall' }, exit_pose: { facing: 'hall' } },
    { from: 'sign_d', to: 'conference_room', action: 'left_then_straight', entry_pose: { facing: 'hall' }, exit_pose: { facing: 'hall' } },
    { from: 'conference_room', to: 'sign_d', action: 'right_then_straight', entry_pose: { facing: 'hall' }, exit_pose: { facing: 'hall' } },
    // Destinations off C
    { from: 'sign_c', to: 'kitchen', action: 'approach_visible', entry_pose: null, exit_pose: null },
    { from: 'kitchen', to: 'sign_c', action: 'around_then_straight', entry_pose: { facing: 'tables' }, exit_pose: { facing: 'tables' } },
    { from: 'sign_c', to: 'team_tables', action: 'right_then_straight', entry_pose: { facing: 'tables' }, exit_pose: { facing: 'tables' } },
    { from: 'team_tables', to: 'sign_c', action: 'left_then_straight', entry_pose: { facing: 'tables' }, exit_pose: { facing: 'tables' } },
    // Destinations off E
    { from: 'sign_e', to: 'call_booth_3', action: 'approach_visible', entry_pose: null, exit_pose: null },
    { from: 'call_booth_3', to: 'sign_e', action: 'around_then_straight', entry_pose: { facing: 'windows' }, exit_pose: { facing: 'windows' } },
    { from: 'sign_e', to: 'call_booth_4', action: 'left_then_straight', entry_pose: { facing: 'windows' }, exit_pose: { facing: 'windows' } },
    { from: 'call_booth_4', to: 'sign_e', action: 'right_then_straight', entry_pose: { facing: 'windows' }, exit_pose: { facing: 'windows' } },
  ],
};
