import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Provider, useStore } from '../lib/store';
import { C, Loading, s } from '../components/ui';

function Navigation() {
  const { ready, user, busy, message, dismiss } = useStore();
  if (!ready) return <Loading />;
  return <>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="set-detail" />
        <Stack.Screen name="tryon" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
    {busy && <View pointerEvents="none" style={{ position: 'absolute', top: 6, alignSelf: 'center', backgroundColor: '#fff', padding: 10, borderRadius: 20, zIndex: 10 }}><ActivityIndicator color={C.primary} /></View>}
    {message ? <Pressable accessibilityRole="alert" onPress={dismiss} style={{ position: 'absolute', top: 48, left: 16, right: 16, zIndex: 20, backgroundColor: C.ink, padding: 13, borderRadius: 10 }}><Text style={{ color: '#fff', fontSize: 12 }}>{message}　×</Text></Pressable> : null}
  </>;
}
export default function RootLayout() {
  return <SafeAreaProvider><Provider><SafeAreaView style={s.shell} edges={['top', 'bottom']}><StatusBar style="dark" /><Navigation /></SafeAreaView></Provider></SafeAreaProvider>;
}
