export function actionColor(actionType: string): string {
  const type = actionType.toLowerCase();
  if (type.includes("fail") || type.includes("error")) return "red";
  if (type.includes("create") || type.includes("post")) return "accent";
  return "gray";
}
