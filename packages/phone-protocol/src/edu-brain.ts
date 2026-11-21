/** Where a bot's Edu brain lives. `own` (the default when absent): a brain of its own in the app's data folder, created on
 * first use. `folder`: the `.edu` brain already in `path`, which several bots may share. `off`: no Edu brain. */
export type EduBrainSetting = { mode: "off" } | { mode: "own" } | { mode: "folder"; path: string };
