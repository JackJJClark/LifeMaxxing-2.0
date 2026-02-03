import { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Pressable, View } from 'react-native';

export default function SlideOverFullScreen({
  open,
  onClose,
  children,
  backdropClose = true,
}) {
  const w = Dimensions.get('window').width;
  const x = useRef(new Animated.Value(w)).current;

  useEffect(() => {
    if (open) {
      Animated.timing(x, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(x, {
        toValue: w,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [open, w, x]);

  if (!open) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 9999,
      }}
    >
      <Pressable
        onPress={() => {
          if (backdropClose) onClose?.();
        }}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: 'rgba(0,0,0,0.55)',
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          transform: [{ translateX: x }],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
