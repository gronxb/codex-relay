import { Button, ContentUnavailableView, Host, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, padding } from "@expo/ui/swift-ui/modifiers";
import type { SFSymbol } from "sf-symbols-typescript";
import { StyleSheet } from "react-native";

import type { EmptyStateProps } from "./empty-state";

export type { EmptyStateProps } from "./empty-state";

// SwiftUI ContentUnavailableView with an optional bordered action under it.
export function EmptyState({ title, description, systemImage, action }: EmptyStateProps) {
  return (
    <Host colorScheme="dark" style={styles.fill}>
      <VStack spacing={4}>
        <ContentUnavailableView
          title={title}
          description={description}
          systemImage={systemImage as SFSymbol}
        />
        {action ? (
          <Button
            label={action.label}
            onPress={action.onPress}
            modifiers={[buttonStyle("bordered"), padding({ bottom: 32 })]}
          />
        ) : null}
      </VStack>
    </Host>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
