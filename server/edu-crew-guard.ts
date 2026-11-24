/** Edu 6.0.0 refuses `edu brain approve` and `edu brain reject` from a process whose EDU_CREW_JOB is set, and refuses every
 * memory write too. Security: this only stops a bot that does not try; a bot's shell can unset the variable, so the hard
 * boundary is Edu's own (an approval that needs a secret only the app holds). */
export const EDU_CREW_GUARD = "EDU_CREW_JOB";

/** Puts the crew-worker guard in an engine's environment. A guard Edu Bot itself inherited (Edu Bot running as a crew
 * worker) is kept as it is. */
export function guardEduCrew(env: Record<string, string | undefined>, botId?: string, inherited: NodeJS.ProcessEnv = process.env): void {
  const outer = inherited[EDU_CREW_GUARD];
  env[EDU_CREW_GUARD] = outer?.trim() ? outer : botId ? `edu-bot:${botId}` : "edu-bot";
}

/** Whether Edu Bot itself runs inside an Edu crew job. */
export function inheritsEduCrewGuard(inherited: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(inherited[EDU_CREW_GUARD]?.trim());
}
