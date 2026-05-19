import type { TextProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui/text";
import { Fonts, ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  type?: "default" | "title" | "small" | "smallBold" | "subtitle" | "link" | "linkPrimary" | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = "default", themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      {...rest}
      style={[
        { color: theme[themeColor ?? "text"] },
        type === "default" && styles.default,
        type === "title" && styles.title,
        type === "small" && styles.small,
        type === "smallBold" && styles.smallBold,
        type === "subtitle" && styles.subtitle,
        type === "link" && styles.link,
        type === "linkPrimary" && styles.linkPrimary,
        type === "code" && styles.code,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  default: {
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  title: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 48,
    fontWeight: "600",
    lineHeight: 52,
  },
  subtitle: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 32,
    fontWeight: "600",
    lineHeight: 44,
  },
  link: {
    fontFamily: Fonts.sansMedium,
    lineHeight: 30,
    fontSize: 14,
    fontWeight: "500",
  },
  linkPrimary: {
    fontFamily: Fonts.sansMedium,
    lineHeight: 30,
    fontSize: 14,
    fontWeight: "500",
    color: "#3c87f7",
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
});
