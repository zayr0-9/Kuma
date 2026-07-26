import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';
import {
  ChevronRight,
  Folder,
  HardDrive,
  type LucideIcon,
  MonitorSmartphone,
  Settings2,
  UploadCloud,
} from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, Divider, Icon, Screen, Text } from '../src/components/index.ts';
import { useTheme } from '../src/theme/index.ts';
import { pingNativeModule } from '../src/native/index.ts';

// Home. A calm landing: what the app is, whether the native module is present, and the way into the
// three real surfaces — with the diagnostic spikes tucked below in a muted group.
export default function HomeScreen(): ReactElement {
  const t = useTheme();
  const router = useRouter();
  const native = pingNativeModule();

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display">FolderSync</Text>
        <Text variant="body" tone="muted">
          Back up your phone’s folders to your desktop over Wi‑Fi.
        </Text>
      </View>

      <View style={[styles.statusLine, { gap: t.space.sm }]}>
        <View
          style={[styles.dot, { backgroundColor: native.ok ? t.colors.success : t.colors.danger }]}
        />
        <Text variant="caption" tone="muted">
          {native.ok ? 'Native module ready' : `Native module not linked (${native.reason})`}
        </Text>
      </View>

      <NavCard
        icon={Folder}
        accent
        title="Folders"
        subtitle="Choose folders and back them up"
        onPress={() => router.push('/folders')}
      />
      <NavCard
        icon={UploadCloud}
        title="Transfers"
        subtitle="Active uploads and recent history"
        onPress={() => router.push('/transfers')}
      />
      <NavCard
        icon={MonitorSmartphone}
        title="Pair a desktop"
        subtitle="Scan a code to connect a computer"
        onPress={() => router.push('/spike-pairing')}
      />

      <Text variant="label" tone="subtle" style={styles.sectionLabel}>
        Diagnostics
      </Text>
      <Card tone="sunken" padding="none">
        <DiagRow icon={HardDrive} label="SAF access" onPress={() => router.push('/spike-saf')} />
        <Divider />
        <DiagRow
          icon={Settings2}
          label="Foreground service"
          onPress={() => router.push('/spike-service')}
        />
      </Card>

      <StatusBar style="auto" />
    </Screen>
  );
}

function NavCard({
  icon,
  title,
  subtitle,
  accent = false,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  accent?: boolean;
  onPress: () => void;
}): ReactElement {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.navCard,
        {
          backgroundColor: pressed ? t.colors.surfaceSunken : t.colors.surface,
          borderRadius: t.radius.lg,
          padding: t.space.lg,
          gap: t.space.md,
        },
        pressed ? t.elevation[0] : t.elevation[1],
        pressed && styles.nudge,
      ]}
    >
      <View
        style={[
          styles.chip,
          { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill },
        ]}
      >
        <Icon icon={icon} tone={accent ? 'accent' : 'text'} />
      </View>
      <View style={styles.navText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={18} />
    </Pressable>
  );
}

function DiagRow({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}): ReactElement {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.diagRow,
        { padding: t.space.lg, gap: t.space.md },
        pressed && { backgroundColor: t.colors.surface, borderRadius: t.radius.lg },
      ]}
    >
      <Icon icon={icon} size={18} />
      <Text variant="body" tone="muted" style={styles.diagLabel}>
        {label}
      </Text>
      <Icon icon={ChevronRight} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  diagLabel: { flex: 1 },
  diagRow: { alignItems: 'center', flexDirection: 'row' },
  dot: { borderRadius: 999, height: 8, width: 8 },
  header: { gap: 4 },
  nudge: { transform: [{ translateY: 1 }] },
  navCard: { alignItems: 'center', flexDirection: 'row' },
  navText: { flex: 1, gap: 2 },
  sectionLabel: { marginTop: 8 },
  statusLine: { alignItems: 'center', flexDirection: 'row', marginBottom: 4 },
});
