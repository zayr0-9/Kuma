import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

// Shared action button for the spike diagnostic screens (48dp touch target, agent_design
// §4). Not a product component — the real UI gets its buttons from the design system when
// packages/ui lands.
export function SpikeButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        disabled === true && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#1f2933',
    borderRadius: 8,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
