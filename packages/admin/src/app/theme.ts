import { createTheme, type MantineColorsTuple } from "@mantine/core";

// 운영 화면 전체가 같은 상태 언어를 사용하도록 색상과 형태를 theme가 소유한다.
// chartreuse accent는 선택과 실행, attention은 확인이 필요한 상태에만 쓴다.

const accent: MantineColorsTuple = [
  "#f7ffdc",
  "#efffb5",
  "#e6ff89",
  "#d9ff57",
  "#c9f53f",
  "#afd827",
  "#8daf18",
  "#69840f",
  "#465909",
  "#2c3905",
];

// pending/attention 표시용 경고색.
const attention: MantineColorsTuple = [
  "#fff6e5",
  "#ffe9bd",
  "#ffd88f",
  "#ffc45c",
  "#f5a623",
  "#d9890e",
  "#ad6907",
  "#824d08",
  "#623a09",
  "#432606",
];

// 밝은 작업 캔버스부터 짙은 navigation shell까지 이어지는 중립 사다리.
const ink: MantineColorsTuple = [
  "#f5f6f1",
  "#e9ebe3",
  "#d5d8ce",
  "#b6baae",
  "#91978a",
  "#70766a",
  "#555b50",
  "#3b4038",
  "#272b25",
  "#171a16",
];

export const CANVAS_CREAM = "#f5f6f1";

export const theme = createTheme({
  colors: { accent, attention, ink },
  primaryColor: "accent",
  primaryShade: 3,
  autoContrast: true,
  luminanceThreshold: 0.4,
  white: "#ffffff",
  black: "#171a16",
  fontFamily:
    'Pretendard, "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  headings: {
    fontFamily:
      'Pretendard, "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: "700",
  },
  defaultRadius: "md",
  radius: { xs: "6px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
  shadows: {
    xs: "0 1px 2px rgba(23, 26, 22, 0.05)",
    sm: "0 8px 24px rgba(23, 26, 22, 0.07)",
    md: "0 16px 40px rgba(23, 26, 22, 0.1)",
    lg: "0 24px 64px rgba(23, 26, 22, 0.14)",
    xl: "0 32px 80px rgba(23, 26, 22, 0.18)",
  },
  components: {
    Button: { defaultProps: { radius: "md", fw: 650 } },
    Card: { defaultProps: { withBorder: true, shadow: "xs", radius: "lg" } },
    Paper: { defaultProps: { withBorder: true, shadow: "xs", radius: "lg" } },
    Table: {
      defaultProps: {
        highlightOnHover: true,
        verticalSpacing: "sm",
        horizontalSpacing: "md",
      },
    },
    Modal: { defaultProps: { radius: "lg", centered: true } },
    TextInput: { defaultProps: { radius: "md" } },
    PasswordInput: { defaultProps: { radius: "md" } },
    Textarea: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md" } },
  },
});
