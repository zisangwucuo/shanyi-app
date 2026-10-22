import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Provider, useStore } from '../lib/store';
import { Button, C, Icon, Loading, LogoutButton, Screen, s } from '../components/ui';

function Navigation() {
  const { ready, user, busy, message, messageId, dismiss, recovery, loadError, refresh, notify } = useStore();
  const insets = useSafeAreaInsets();
  if (!ready) return <Loading />;
  if (recovery) return <Screen showLoadError={false}><View style={{ paddingVertical: 64 }}><Icon name="shirt" color={C.primary} /><Text style={[s.kicker, { marginTop: 24 }]}>WELCOME BACK</Text><Text style={[s.title, { fontSize: 27, marginTop: 12 }]}>稍等，衣橱还没打开</Text><Text style={[s.body, { marginTop: 14 }]}>暂时无法完成登录恢复。请检查网络后，再试一次。</Text><Text style={[s.small, { marginTop: 8 }]}>{loadError}</Text><Button title={busy ? '正在恢复…' : '重试恢复'} disabled={busy} onPress={() => void refresh().catch(error => notify((error as Error).message))} /><LogoutButton /></View></Screen>;
  return <>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="set-detail" />
        <Stack.Screen name="tryon" />
        <Stack.Screen name="data" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
    {busy && <View pointerEvents="none" style={{ position: 'absolute', top: 6, alignSelf: 'center', backgroundColor: '#fff', padding: 10, borderRadius: 20, zIndex: 10 }}><ActivityIndicator color={C.primary} /></View>}
    {message ? <View pointerEvents="box-none" style={[toast.position, { top: insets.top + 60, left: Math.max(insets.left, 16), right: Math.max(insets.right, 16) }]}>
      <View style={toast.card}>
        <View style={toast.icon} accessible={false}><Icon name="bell" color={C.primary} /></View>
        <Text key={messageId} accessibilityRole="alert" accessibilityLiveRegion="polite" style={toast.message}>{message}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭消息提示" onPress={dismiss} style={({ pressed }) => [toast.close, pressed && { backgroundColor: C.soft }]}><Icon name="close" color={C.primary} /></Pressable>
      </View>
    </View> : null}
  </>;
}
const toast = StyleSheet.create({
  position: { position: 'absolute', zIndex: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF9F1', borderWidth: 1, borderColor: '#E7D2BF', borderRadius: 18, paddingLeft: 14, paddingRight: 6, paddingVertical: 8, shadowColor: '#70452E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 4 },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 20 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

export default function RootLayout() {
  return <SafeAreaProvider><Provider><SafeAreaView style={s.shell} edges={['top', 'bottom']}><StatusBar style="dark" /><Navigation /></SafeAreaView></Provider></SafeAreaProvider>;
}
