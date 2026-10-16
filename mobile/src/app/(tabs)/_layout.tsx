import { router, Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native';
import { C, Icon, s } from '../../components/ui';
import { useStore } from '../../lib/store';

export default function TabsLayout() {
  const { user, notify, dismiss } = useStore();
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  const showHint = (message: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    notify(message);
    hintTimer.current = setTimeout(dismiss, 2400);
  };
  const tabIcon = (name: string, color: ColorValue, focused: boolean) => <View style={[nav.tabIcon, focused && { backgroundColor: C.soft }]}><Icon name={name} color={color} /></View>;

  return <Tabs screenOptions={{
    header: () => <View style={nav.header}>
      <View style={nav.left}>
        <Pressable accessibilityRole="button" accessibilityLabel="进入个人中心" hitSlop={5} onPress={() => router.navigate('/profile')} style={({ pressed }) => [s.avatar, nav.avatar, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={{ color: C.primary, fontWeight: '600' }}>{user?.name.slice(0, 1) || '善'}</Text>
        </Pressable>
      </View>
      <View style={nav.brand}>
        <Text style={[s.title, nav.brandName]}>善衣</Text>
        <Text style={nav.brandEnglish}>SHANYI</Text>
      </View>
      <View style={nav.right}>
        <Pressable accessibilityRole="button" accessibilityLabel="搜索" hitSlop={4} onPress={() => showHint('可通过首页场合标签查找通勤、约会等搭配')} style={({ pressed }) => [nav.action, pressed && nav.pressed]}><Icon name="search" color={C.ink} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="通知" hitSlop={4} onPress={() => showHint('暂无新通知')} style={({ pressed }) => [nav.action, pressed && nav.pressed]}><Icon name="bell" color={C.ink} /></Pressable>
      </View>
    </View>,
    tabBarActiveTintColor: C.primary,
    tabBarInactiveTintColor: C.sub,
    tabBarStyle: { backgroundColor: '#FCFAF7', borderTopColor: C.line, height: 64, paddingBottom: 8, paddingTop: 6 },
    tabBarLabelStyle: { fontSize: 10 },
  }}>
    <Tabs.Screen name="index" options={{ title: '首页', tabBarIcon: ({ color, focused }) => tabIcon('home', color, focused) }} />
    <Tabs.Screen name="wardrobe" options={{ title: '衣橱', tabBarIcon: ({ color, focused }) => tabIcon('shirt', color, focused) }} />
    <Tabs.Screen name="recommend" options={{ title: '推荐', tabBarIcon: ({ color, focused }) => tabIcon('sparkles', color, focused) }} />
    <Tabs.Screen name="community" options={{ title: '社区', tabBarIcon: ({ color, focused }) => tabIcon('users', color, focused) }} />
    <Tabs.Screen name="profile" options={{ title: '我的', tabBarIcon: ({ color, focused }) => tabIcon('user', color, focused) }} />
  </Tabs>;
}

const nav = StyleSheet.create({
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg },
  left: { width: 44, alignItems: 'flex-start' },
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.soft, borderWidth: 1, borderColor: C.line },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  brandName: { fontSize: 21, fontWeight: '600', letterSpacing: 3 },
  brandEnglish: { fontSize: 9, letterSpacing: 3, color: '#A79D90' },
  right: { width: 88, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  action: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: C.soft, transform: [{ scale: 0.94 }] },
  tabIcon: { width: 45, height: 27, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
