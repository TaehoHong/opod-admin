export function compileImagePrompt(
  profile: { appearancePrompt: string; stylePrompt: string } | null,
  request: string,
): string {
  return [profile?.appearancePrompt ?? "", request, profile?.stylePrompt ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}
