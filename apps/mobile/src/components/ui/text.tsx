import { cn } from "@/lib/utils";
import * as Slot from "@rn-primitives/slot";
import { cva, type VariantProps } from "class-variance-authority";
import { use } from "react";
import * as React from "react";
import { Platform, Text as RNText, type Role, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Fonts } from "@/constants/theme";

const textVariants = cva(
  cn(
    "text-base text-foreground",
    Platform.select({
      web: "select-text",
    }),
  ),
  {
    variants: {
      variant: {
        default: "",
        h1: cn(
          "text-center text-4xl font-extrabold tracking-tight",
          Platform.select({ web: "scroll-m-20 text-balance" }),
        ),
        h2: cn(
          "border-b border-border pb-2 text-3xl font-semibold tracking-tight",
          Platform.select({ web: "scroll-m-20 first:mt-0" }),
        ),
        h3: cn("text-2xl font-semibold tracking-tight", Platform.select({ web: "scroll-m-20" })),
        h4: cn("text-xl font-semibold tracking-tight", Platform.select({ web: "scroll-m-20" })),
        p: "mt-3 leading-7 sm:mt-6",
        blockquote: "mt-4 border-l-2 pl-3 italic sm:mt-6 sm:pl-6",
        code: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
        lead: "text-xl text-muted-foreground",
        large: "text-lg font-semibold",
        small: "text-sm font-medium leading-none",
        muted: "text-sm text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type TextVariantProps = VariantProps<typeof textVariants>;
type TextVariant = NonNullable<TextVariantProps["variant"]>;

const ROLE: Partial<Record<TextVariant, Role>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  blockquote: Platform.select({ web: "blockquote" as Role }),
  code: Platform.select({ web: "code" as Role }),
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = {
  h1: "1",
  h2: "2",
  h3: "3",
  h4: "4",
};

const TextClassContext = React.createContext<string | undefined>(undefined);

function Text({
  className,
  asChild = false,
  style,
  variant = "default",
  ...props
}: React.ComponentProps<typeof RNText> &
  TextVariantProps &
  React.RefAttributes<RNText> & {
    asChild?: boolean;
  }) {
  const textClass = use(TextClassContext);
  const Component = asChild ? Slot.Text : RNText;
  const resolvedVariant = variant ?? "default";
  return (
    <Component
      {...props}
      allowFontScaling={false}
      maxFontSizeMultiplier={1}
      className={cn(textVariants({ variant }), textClass, className)}
      role={variant ? ROLE[resolvedVariant] : undefined}
      aria-level={variant ? ARIA_LEVEL[resolvedVariant] : undefined}
      style={[styles.base, fontStyles[resolvedVariant], style]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: Fonts.sans,
  },
});

const fontStyles = StyleSheet.create<
  Record<TextVariant, Pick<TextStyle, "fontFamily" | "fontWeight">>
>({
  default: {
    fontFamily: Fonts.sans,
    fontWeight: "400",
  },
  h1: {
    fontFamily: Fonts.sansBold,
    fontWeight: "800",
  },
  h2: {
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  h3: {
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  h4: {
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  p: {
    fontFamily: Fonts.sans,
    fontWeight: "400",
  },
  blockquote: {
    fontFamily: Fonts.sans,
    fontWeight: "400",
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: "600",
  },
  lead: {
    fontFamily: Fonts.sans,
    fontWeight: "400",
  },
  large: {
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  small: {
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
  },
  muted: {
    fontFamily: Fonts.sans,
    fontWeight: "400",
  },
});

export { Text, TextClassContext };
