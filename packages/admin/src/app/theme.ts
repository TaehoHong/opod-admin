import { createTheme, type MantineColorsTuple } from "@mantine/core";

// 승인된 톤앤매너를 Theme token으로 옮긴다 (docs/04-design-rules.md
// "Visual Direction"). 삭제한 legacy stylesheet에서 승인된 색상값만
// Theme token으로 옮겼다. Mantine 색상은 10단계 tuple을 요구하므로 기존
// 사다리를 그대로 채운다.

const accent: MantineColorsTuple = [
  "#e5f1ff",
  "#cce4ff",
  "#99c9ff",
  "#4da2ff",
  "#007aff",
  "#007aff",
  "#0056b3",
  "#004085",
  "#003366",
  "#00224d",
];

// pending/attention 표시용 경고색.
const attention: MantineColorsTuple = [
  "#fff3e0",
  "#ffe3bd",
  "#ffd08f",
  "#ffb84d",
  "#ff9f0a",
  "#ff9f0a",
  "#cc7f08",
  "#995f06",
  "#7a4c05",
  "#5c3904",
];

// ink → cream 중립 사다리.
const ink: MantineColorsTuple = [
  "#f8f7f7",
  "#f1eeee",
  "#dcdada",
  "#bcbaba",
  "#9a9898",
  "#6e6e73",
  "#646262",
  "#424245",
  "#302c2c",
  "#201d1d",
];

export const CANVAS_CREAM = "#fdfcfc";

export const theme = createTheme({
  colors: { accent, attention, ink },
  primaryColor: "accent",
  primaryShade: 4,
  white: CANVAS_CREAM,
  black: "#201d1d",
  fontFamily:
    '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  headings: { fontFamily: "inherit", fontWeight: "600" },
  // 작은 radius와 얇은 경계선, 그림자 없음.
  defaultRadius: "sm",
  radius: { xs: "4px", sm: "4px", md: "4px", lg: "4px", xl: "4px" },
  shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
  components: {
    Card: { defaultProps: { withBorder: true, shadow: "none" } },
    Paper: { defaultProps: { withBorder: true, shadow: "none" } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: "xs" } },
  },
});
