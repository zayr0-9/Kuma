import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Download, ImageOff, X } from 'lucide-react-native';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  type ListRenderItemInfo,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text } from '../src/components/index.ts';
import { useTheme } from '../src/theme/index.ts';
import {
  cachedThumbnails,
  downloadRemoteImage,
  fetchRemoteImage,
  fetchThumbnail,
  isNativeLinked,
  listRemoteImages,
  type RemoteImageItem,
} from '../src/native/gallery.ts';

// Folder gallery (spec 6.6, 5.5): browse the images already backed up for a folder — including
// files removed from the phone under delete_after_verified_backup — and download them back.
// The desktop is the source of truth: listRemoteImages pages the listing (lazy-loaded
// thumbnails), and tapping one opens a full-screen pan/zoom viewer. All bytes are fetched
// natively over the pinned TLS client; JS only ever renders local file:// URIs.

const PAGE_SIZE = 60;
const COLUMNS = 3;
const GRID_GAP = 3;
const PREFETCH_CONCURRENCY = 4;

export default function GalleryScreen(): ReactElement {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const linked = isNativeLinked();
  const params = useLocalSearchParams<{ rootId?: string; name?: string }>();
  const rootId = typeof params.rootId === 'string' ? params.rootId : '';
  const folderName = typeof params.name === 'string' ? params.name : 'Photos';

  const [items, setItems] = useState<RemoteImageItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const mounted = useRef(true);
  // Guards against overlapping page fetches (onEndReached can fire repeatedly).
  const fetching = useRef(false);

  // Thumbnail resolution (spec 6.6): the desktop-generated thumbnails are cached durably on the
  // phone, keyed per folder → version id. For each loaded page we ask the native cache which
  // versions we already hold (rendered instantly) and fetch only the misses, bounded to a few at
  // a time — so a re-opened gallery never re-stresses the desktop for thumbnails it already has.
  const [thumbUri, setThumbUri] = useState<Record<string, string>>({});
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
  const resolvedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const activeCountRef = useRef(0);
  const queueRef = useRef<RemoteImageItem[]>([]);

  const resolveHit = useCallback((versionId: string, uri: string) => {
    resolvedRef.current.add(versionId);
    setThumbUri((prev) => (prev[versionId] === uri ? prev : { ...prev, [versionId]: uri }));
  }, []);
  const resolveFail = useCallback((versionId: string) => {
    resolvedRef.current.add(versionId);
    setThumbFailed((prev) => (prev[versionId] === true ? prev : { ...prev, [versionId]: true }));
  }, []);

  // Drain the miss queue, keeping at most PREFETCH_CONCURRENCY native fetches in flight.
  const pump = useCallback(() => {
    while (activeCountRef.current < PREFETCH_CONCURRENCY && queueRef.current.length > 0) {
      const item = queueRef.current.shift();
      if (item === undefined) break;
      if (resolvedRef.current.has(item.versionId) || inFlightRef.current.has(item.versionId)) {
        continue;
      }
      inFlightRef.current.add(item.versionId);
      activeCountRef.current += 1;
      void fetchThumbnail(rootId, item.fileId, item.versionId)
        .then((r) => {
          if (!mounted.current) return;
          if (r.ok) resolveHit(item.versionId, r.uri);
          else resolveFail(item.versionId);
        })
        .catch(() => {
          if (mounted.current) resolveFail(item.versionId);
        })
        .finally(() => {
          inFlightRef.current.delete(item.versionId);
          activeCountRef.current -= 1;
          if (mounted.current) pump();
        });
    }
  }, [rootId, resolveHit, resolveFail]);

  // Seed cache hits for a freshly loaded page, then enqueue the misses for bounded prefetch.
  const prefetchThumbs = useCallback(
    async (batch: RemoteImageItem[]) => {
      if (!linked || rootId === '' || batch.length === 0) return;
      const wanted = batch.filter((i) => !resolvedRef.current.has(i.versionId));
      if (wanted.length === 0) return;
      try {
        const cached = await cachedThumbnails(
          rootId,
          wanted.map((i) => i.versionId),
        );
        if (!mounted.current) return;
        if (cached.ok) {
          for (const [versionId, uri] of Object.entries(cached.uris)) resolveHit(versionId, uri);
        }
      } catch {
        // Ignore — fall through and fetch everything as a miss.
      }
      queueRef.current.push(...wanted.filter((i) => !resolvedRef.current.has(i.versionId)));
      pump();
    },
    [linked, rootId, resolveHit, pump],
  );

  const loadPage = useCallback(
    async (nextCursor: string | null) => {
      if (!linked || rootId === '' || fetching.current) return;
      fetching.current = true;
      try {
        const result = await listRemoteImages(rootId, nextCursor, PAGE_SIZE);
        if (!mounted.current) return;
        if (!result.ok) {
          setError(friendlyReason(result.reason));
          setHasMore(false);
          return;
        }
        setError(null);
        setItems((prev) => (nextCursor === null ? result.items : [...prev, ...result.items]));
        setCursor(result.nextCursor);
        setHasMore(result.nextCursor !== null);
        void prefetchThumbs(result.items);
      } catch {
        if (mounted.current) setError('Could not load photos.');
      } finally {
        fetching.current = false;
        if (mounted.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [linked, rootId, prefetchThumbs],
  );

  useEffect(() => {
    mounted.current = true;
    void loadPage(null);
    return () => {
      mounted.current = false;
    };
  }, [loadPage]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || loading || fetching.current) return;
    setLoadingMore(true);
    void loadPage(cursor);
  }, [hasMore, loadingMore, loading, cursor, loadPage]);

  const cellSize = Math.floor(
    (Dimensions.get('window').width - GRID_GAP * (COLUMNS - 1)) / COLUMNS,
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<RemoteImageItem>) => (
      <Thumb
        size={cellSize}
        uri={thumbUri[item.versionId]}
        failed={thumbFailed[item.versionId] === true}
        onPress={() => setViewerIndex(index)}
      />
    ),
    [cellSize, thumbUri, thumbFailed],
  );

  if (!linked) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.canvas }]}>
        <Text variant="body" tone="muted">
          Rebuild the dev client to include the native module.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.canvas }]}>
      <Stack.Screen options={{ title: folderName }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <View
            style={[
              styles.emptyChip,
              { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill },
            ]}
          >
            <Icon icon={ImageOff} size={24} tone="default" />
          </View>
          <Text variant="bodyStrong">{error === null ? 'No photos yet' : 'Can’t load photos'}</Text>
          <Text variant="caption" tone="muted" style={styles.emptyHint}>
            {error ?? 'Images backed up from this folder will appear here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.fileId}
          numColumns={COLUMNS}
          renderItem={renderItem}
          columnWrapperStyle={styles.column}
          contentContainerStyle={{ paddingBottom: insets.bottom + t.space.lg, gap: GRID_GAP }}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={t.colors.accent} style={styles.footer} /> : null
          }
        />
      )}

      {viewerIndex !== null ? (
        <Viewer
          items={items}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNeedMore={onEndReached}
        />
      ) : null}
      <StatusBar style="auto" />
    </View>
  );
}

// A single grid cell. Presentational: the parent resolves thumbnails (native cache hit or a
// bounded prefetch) and passes the local `file://` URI down, so a large folder never blocks on a
// wall of network fetches and a re-opened gallery renders instantly from the durable cache.
function Thumb({
  size,
  uri,
  failed,
  onPress,
}: {
  size: number;
  uri: string | undefined;
  failed: boolean;
  onPress: () => void;
}): ReactElement {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { width: size, height: size, backgroundColor: t.colors.surfaceSunken },
        pressed && styles.pressed,
      ]}
    >
      {uri !== undefined ? (
        <Image source={{ uri }} style={styles.fill} resizeMode="cover" />
      ) : (
        <View style={styles.center}>
          {failed ? (
            <Icon icon={ImageOff} size={18} color={t.colors.textSubtle} />
          ) : (
            <ActivityIndicator color={t.colors.textSubtle} size="small" />
          )}
        </View>
      )}
    </Pressable>
  );
}

// Full-screen viewer: a horizontal pager over the backed-up images, each pinch/pan/double-tap
// zoomable. Paging is disabled while an image is zoomed so a pan moves the image instead of
// changing page. A download saves the current image into the phone's photo library.
function Viewer({
  items,
  initialIndex,
  onClose,
  onNeedMore,
}: {
  items: RemoteImageItem[];
  initialIndex: number;
  onClose: () => void;
  onNeedMore: () => void;
}): ReactElement {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const current = items[index];

  const onDownload = useCallback(async () => {
    if (current === undefined || downloading) return;
    setDownloading(true);
    try {
      const result = await downloadRemoteImage(current.fileId, current.name, current.contentType);
      Alert.alert(
        result.ok ? 'Saved to Photos' : 'Download failed',
        result.ok
          ? `${current.name} was saved to your photo library.`
          : friendlyReason(result.reason),
      );
    } finally {
      setDownloading(false);
    }
  }, [current, downloading]);

  const renderPage = useCallback(
    ({ item }: ListRenderItemInfo<RemoteImageItem>) => (
      <ZoomableImage item={item} width={width} height={height} onZoomChange={setZoomed} />
    ),
    [width, height],
  );

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewerRoot}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.fileId}
          renderItem={renderPage}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(next);
            if (next >= items.length - 3) onNeedMore();
          }}
        />

        <View style={[styles.viewerBar, { top: insets.top + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
            style={styles.barButton}
          >
            <Icon icon={X} color="#FFFFFF" size={24} />
          </Pressable>
          <Text variant="bodyStrong" style={styles.viewerCount}>
            {index + 1} / {items.length}
          </Text>
          {downloading ? (
            <ActivityIndicator color="#FFFFFF" style={styles.barButton} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Download"
              onPress={() => void onDownload()}
              hitSlop={8}
              style={styles.barButton}
            >
              <Icon icon={Download} color="#FFFFFF" size={24} />
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const MAX_SCALE = 5;

// A single pinch/pan/double-tap zoomable image inside the viewer. Pan only moves the image
// while zoomed; onZoomChange lets the pager disable horizontal scroll so a pan does not flip
// the page. All gesture callbacks are reanimated worklets; only the zoom flag crosses to JS.
function ZoomableImage({
  item,
  width,
  height,
  onZoomChange,
}: {
  item: RemoteImageItem;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}): ReactElement {
  const [uri, setUri] = useState<string | null>(null);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useEffect(() => {
    let alive = true;
    void fetchRemoteImage(item.fileId, item.versionId).then((r) => {
      if (alive && r.ok) setUri(r.uri);
    });
    return () => {
      alive = false;
    };
  }, [item.fileId, item.versionId]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, startScale.value * e.scale));
    })
    .onEnd(() => {
      startScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        startX.value = 0;
        startY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        runOnJS(onZoomChange)(true);
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = startX.value + e.translationX;
        ty.value = startY.value + e.translationY;
      }
    })
    .onEnd(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        startScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        startX.value = 0;
        startY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withTiming(2);
        startScale.value = 2;
        runOnJS(onZoomChange)(true);
      }
    });

  const composed = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width, height }}>
        {uri !== null ? (
          <Animated.Image
            source={{ uri }}
            style={[{ width, height }, animatedStyle]}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

function friendlyReason(reason: string): string {
  switch (reason) {
    case 'not_paired':
      return 'Pair a desktop first.';
    case 'network':
      return 'Could not reach the desktop. Check it is on the same Wi-Fi.';
    case 'pin_mismatch':
      return 'The desktop identity changed. Pair again.';
    case 'fetch_failed':
      return 'The desktop could not send this image. Try again.';
    case 'root_not_mapped':
      return 'This folder is not linked to the desktop.';
    default:
      return 'Something went wrong. Try again.';
  }
}

const styles = StyleSheet.create({
  barButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  center: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center' },
  column: { gap: GRID_GAP },
  emptyChip: { alignItems: 'center', height: 56, justifyContent: 'center', width: 56 },
  emptyHint: { paddingHorizontal: 32, textAlign: 'center' },
  fill: { height: '100%', width: '100%' },
  footer: { paddingVertical: 16 },
  pressed: { opacity: 0.7 },
  viewerBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 8,
    position: 'absolute',
    right: 8,
  },
  viewerCount: { color: '#FFFFFF' },
  viewerRoot: { backgroundColor: '#000000', flex: 1 },
});
