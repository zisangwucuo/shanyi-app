import { router } from 'expo-router';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { asset, json, type Outfit, type Recommendation, useStore } from '../lib/store';
export const C = { bg: '#F6F1EA', primary: '#B4552D', ink: '#2E2A25', sub: '#7A7166', line: '#EAE2D8', soft: '#F6E3D8' };
const paths: Record<string, string> = { check: 'm5 12 4 4L19 6', chevronDown: 'm6 9 6 6 6-6', search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M17 17l5 5', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4', home: 'm3 9 9-7 9 7v12H3Z M9 21v-9h6v9', shirt: 'm8 3-5 2-1 5h4v11h12V10h4l-1-5-5-2c0 5-8 5-8 0Z', sparkles: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z', users: 'M15 21v-3c0-5-12-5-12 0v3 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4c5 0 5 7 0 7 M18 15c4 0 4 3 4 6', user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21c0-10 16-10 16 0', back: 'm15 5-7 7 7 7', close: 'm6 6 12 12 M18 6 6 18', heart: 'M12 21 3 12C-3 4 7-1 12 6c5-7 15-2 9 6Z', plus: 'M12 4v16 M4 12h16', settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 1v3 M12 20v3 M1 12h3 M20 12h3 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2' };
export function Icon({ name, color = C.sub }: { name: string; color?: ColorValue }) { return <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><Path d={paths[name] || paths.sparkles} /></Svg>; }
export function Checkbox({ label, description, checked, onChange, disabled = false }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const [focused, setFocused] = useState(false);
  const keyboardProps = Platform.OS === 'web' ? {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        if (!disabled && !event.repeat) onChange(!checked);
      }
    },
  } : {};
  return <Pressable {...keyboardProps} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityHint={description} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => onChange(!checked)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => ({ minHeight: 48, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: focused ? C.primary : 'transparent', flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: pressed ? C.soft : 'transparent', opacity: disabled ? 0.45 : 1 })}>
    <View style={{ width: 22, height: 22, marginTop: 1, borderWidth: 1, borderColor: checked ? C.primary : C.sub, borderRadius: 6, backgroundColor: checked ? C.primary : '#fff', alignItems: 'center', justifyContent: 'center' }}>{checked && <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d={paths.check} /></Svg>}</View>
    <View style={{ flex: 1, minWidth: 0 }}><Text style={s.body}>{label}</Text>{description && <Text style={[s.small, { marginTop: 4 }]}>{description}</Text>}</View>
  </Pressable>;
}
export function Button({ title, onPress, soft = false, disabled = false }: { title: string; onPress: () => void; soft?: boolean; disabled?: boolean }) { const [focused, setFocused] = useState(false); return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress} style={({ pressed }) => [s.button, { borderWidth: 1, borderColor: focused ? C.ink : 'transparent', backgroundColor: soft ? C.soft : C.primary, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }]}><Text style={{ color: soft ? C.primary : '#fff', fontWeight: '600', fontSize: 14, lineHeight: 22, textAlign: 'center' }}>{title}</Text></Pressable>; }
export function Field({ label, value, onChangeText, numeric = false, email = false }: { label: string; value: string; onChangeText: (value: string) => void; numeric?: boolean; email?: boolean }) { return <View style={{ marginBottom: 4 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} style={s.input} value={value} onChangeText={onChangeText} keyboardType={numeric ? 'numeric' : email ? 'email-address' : 'default'} autoCapitalize={email ? 'none' : 'sentences'} /></View>; }
export function Chips({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (v: string) => void }) { return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{values.map(value => <Pressable accessibilityRole="button" accessibilityLabel={value} accessibilityState={{ selected: selected === value }} key={value} onPress={() => onSelect(value)} style={({ pressed }) => [s.chip, selected === value && { backgroundColor: C.soft, borderColor: '#D8AD95' }, { opacity: pressed ? 0.7 : 1 }]}><Text style={{ color: selected === value ? C.primary : C.sub, fontSize: 12, fontWeight: selected === value ? '600' : '400' }}>{value}</Text></Pressable>)}</ScrollView>; }
export function Select({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect: (value: string) => void }) { const [open, setOpen] = useState(false); return <View><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}：${selected || '请选择'}`} accessibilityState={{ expanded: open }} style={[s.input, s.between, open && { borderColor: C.primary }]} onPress={() => setOpen(!open)}><Text style={[s.body, { flex: 1 }]}>{selected || '请选择'}</Text><Icon name="chevronDown" /></Pressable>{open && <View style={s.dropdown}>{values.map(value => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected === value }} key={value} style={[s.menu, s.between, selected === value && { backgroundColor: C.soft }]} onPress={() => { onSelect(value); setOpen(false); }}><Text style={[s.body, { flex: 1, color: selected === value ? C.primary : C.ink }]}>{value}</Text>{selected === value && <Icon name="check" color={C.primary} />}</Pressable>)}</View>}</View>; }
export function Sheet({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: ReactNode }) { const { message, dismiss, busy } = useStore(); return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}><View style={s.mask}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭抽屉" /><View style={s.sheet}><View style={s.handle} /><View style={[s.between, { borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 10, marginBottom: 8 }]}><Text style={[s.title, { flex: 1 }]}>{title}</Text><Pressable accessibilityRole="button" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} onPress={onClose} accessibilityLabel="关闭"><Icon name="close" /></Pressable></View>{busy && <ActivityIndicator color={C.primary} style={{ marginVertical: 8 }} />}{message ? <Pressable accessibilityRole="alert" onPress={dismiss} style={[s.info, { marginTop: 12 }]}><Text style={s.body}>{message}　×</Text></Pressable> : null}<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>{children}</ScrollView></View></View></Modal>; }
export function Photo({ uri, square = false, aspectRatio = square ? 1 : 4 / 3 }: { uri?: string; square?: boolean; aspectRatio?: number }) { const [failedUri, setFailedUri] = useState<string>(); const failed = !!uri && failedUri === uri; return uri && !failed ? <Image accessibilityLabel="服饰图片" resizeMode="cover" onError={() => setFailedUri(uri)} source={{ uri: asset(uri) }} style={{ width: '100%', aspectRatio, backgroundColor: '#F4EEE6' }} /> : <View style={{ width: '100%', aspectRatio, backgroundColor: '#F4EEE6', alignItems: 'center', justifyContent: 'center' }}><Icon name="shirt" /><Text style={s.small}>{uri ? '图片暂不可用' : '尚未添加图片'}</Text></View>; }
export function Section({ title, en }: { title: string; en: string }) { return <View style={[s.between, { marginVertical: 16, flexWrap: 'wrap' }]}><Text style={s.title}>{title}</Text><Text style={s.kicker}>{en}</Text></View>; }
export function OutfitSummary({ plan }: { plan?: Recommendation }) {
  if (!plan) return null;
  const pending = plan.matched.filter(match => !match.exact_color).length;
  return <Text style={s.small}>已有 {plan.owned_count}/{plan.total_count} 件{plan.missing.length ? ` · 还缺 ${plan.missing.length} 件` : ''}{pending ? ` · ${pending} 件颜色待确认` : ''}</Text>;
}
export function OutfitTags({ outfit }: { outfit: Outfit }) {
  const tags = [...new Set([outfit.occasion, ...outfit.tags].filter(Boolean))].filter(tag => !outfit.title.includes(tag)).slice(0, 2);
  return tags.length ? <View style={s.tags}>{tags.map(tag => <Text key={tag} style={s.tag}>{tag}</Text>)}</View> : null;
}
export function OutfitCard({ outfit, children }: { outfit: Outfit; children?: ReactNode }) {
  const { recommendations } = useStore();
  const plan = recommendations.find(value => value.outfit.id === outfit.id);
  const detail = () => router.push({ pathname: '/set-detail', params: { id: outfit.id } });
  return <View style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`查看${outfit.title}详情`} onPress={detail}><Photo uri={outfit.cover} /><Text style={s.match}>搭配参考图</Text></Pressable>
    <View style={s.pad}>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看${outfit.title}详情`} onPress={detail} style={[s.between, { minHeight: 44 }]}><Text numberOfLines={2} style={[s.bold, { flex: 1 }]}>{outfit.title}</Text><Text style={s.link}>详情 →</Text></Pressable>
      <OutfitSummary plan={plan} />
      <OutfitTags outfit={outfit} />
      <OutfitActions id={outfit.id}>{children}</OutfitActions>
    </View>
  </View>;
}
export function Screen({ children, showLoadError = true }: { children: ReactNode; showLoadError?: boolean }) { const { refresh, notify, loadError, busy } = useStore(); const [refreshing, setRefreshing] = useState(false); const reload = async () => { setRefreshing(true); try { await refresh(); } catch (error) { notify((error as Error).message); } finally { setRefreshing(false); } }; return <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.primary} onRefresh={() => void reload()} />} contentContainerStyle={s.screen}>{showLoadError && loadError ? <View style={s.info}><Text style={s.bold}>内容暂未更新，已保留上次内容</Text><Text style={s.body}>{loadError}</Text><Button title={busy ? '正在更新…' : '重新刷新'} soft disabled={busy || refreshing} onPress={() => void reload()} /></View> : null}{children}</ScrollView>; }
export function LogoutButton() {
  const { logout, busy } = useStore();
  const [failure, setFailure] = useState('');
  const leave = async (localOnly = false) => { try { await logout(localOnly); setFailure(''); } catch (error) { setFailure((error as Error).message); } };
  return <><Button title="退出登录" soft disabled={busy} onPress={() => void leave()} /><Sheet title="暂未完成退出" visible={!!failure} onClose={() => { if (!busy) setFailure(''); }}><Text style={s.body}>{failure}</Text><Button title="重试退出并撤销登录" disabled={busy} onPress={() => void leave()} /><Button title="仅退出此设备" soft disabled={busy} onPress={() => void leave(true)} /><Text style={[s.small, { marginTop: 12 }]}>仅退出此设备会清除本地凭证，服务器上的本次登录未确认撤销，将在到期后失效。</Text></Sheet></>;
}
export function OutfitActions({ id, children }: { id: string; children?: ReactNode }) {
  const { activity, busy, mutate, notify } = useStore();
  const [more, setMore] = useState(false);
  const worn = activity.records.some(record => record.outfit_id === id && record.date === activity.today);
  const preference = activity.feedback[id];
  const liked = preference === 'like';
  const feedback = async (value: 'like' | 'dislike' | null) => {
    if (await mutate(`/api/outfit-feedback/${id}`, json({ preference: value }, 'PUT'))) setMore(false);
  };
  const wear = () => void mutate(`/api/outfit-wear/${id}`).then(ok => {
    if (ok) { setMore(false); notify('今天的穿搭已记录，仅匹配到的衣橱衣物增加一次穿着'); }
  });
  return <>
    <View style={[s.row, { marginTop: 12, flexWrap: 'wrap' }]}>
      {children}
      <Pressable accessibilityRole="button" accessibilityLabel={liked ? '已喜欢，取消推荐偏好' : '喜欢这套搭配，用于推荐偏好'} accessibilityState={{ selected: liked, disabled: busy }} disabled={busy} onPress={() => void feedback(liked ? null : 'like')} style={[actions.control, { backgroundColor: liked ? C.soft : 'transparent' }]}>
        <Svg width={21} height={21} viewBox="0 0 24 24" fill={liked ? C.primary : 'none'} stroke={liked ? C.primary : C.sub} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><Path d={paths.heart} /></Svg>
        {!children && <Text style={[s.link, { color: liked ? C.primary : C.sub }]}>{liked ? '已喜欢' : '喜欢'}</Text>}
      </Pressable>
      {!children && <Pressable accessibilityRole="button" accessibilityLabel={worn ? '今天已穿，已记录' : '记录今天已穿'} accessibilityState={{ disabled: busy || worn, selected: worn }} disabled={busy || worn} onPress={wear} style={[actions.control, { backgroundColor: C.soft, opacity: busy ? 0.5 : 1 }]}><Text style={s.link}>{worn ? '已穿' : '今天已穿'}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="更多搭配操作" accessibilityState={{ expanded: more }} onPress={() => setMore(true)} style={[actions.control, { marginLeft: 'auto' }]}><Text style={{ color: C.sub, fontSize: 22 }}>⋯</Text></Pressable>
    </View>
    <Sheet title="搭配操作" visible={more} onClose={() => setMore(false)}>
      <Text style={[s.small, { marginTop: 14 }]}>喜欢与不感兴趣用于调整推荐，不计入社区点赞。</Text>
      {children && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || worn }} disabled={busy || worn} onPress={wear} style={s.menu}><Text style={s.body}>{worn ? '今天已穿 · 已记录' : '今天已穿'}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityState={{ selected: preference === 'dislike', disabled: busy || preference === 'dislike' }} disabled={busy || preference === 'dislike'} onPress={() => void feedback('dislike')} style={s.menu}><Text style={[s.body, { color: preference === 'dislike' ? C.primary : C.ink }]}>{preference === 'dislike' ? '已设为不感兴趣' : '不感兴趣'}</Text></Pressable>
      {!!preference && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void feedback(null)} style={s.menu}><Text style={s.body}>取消反馈</Text></Pressable>}
      <Text style={[s.small, { marginTop: 14 }]}>穿着记录只为当前匹配的衣橱单品计次，缺失单品不计次。可在「我的」查看穿搭历史与管理推荐反馈。</Text>
    </Sheet>
  </>;
}
const actions = StyleSheet.create({ control: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 } });
export function Loading() { return <View style={s.loading}><ActivityIndicator color={C.primary} /><Text style={s.small}>正在整理你的衣橱…</Text></View>; }
export const s = StyleSheet.create({ shell: { flex: 1, width: '100%', maxWidth: 430, alignSelf: 'center', backgroundColor: C.bg }, screen: { padding: 18, paddingBottom: 36 }, title: { color: C.ink, fontSize: 20, lineHeight: 28, fontWeight: '600' }, body: { color: C.ink, fontSize: 14, lineHeight: 22 }, small: { color: C.sub, fontSize: 12, lineHeight: 19 }, bold: { color: C.ink, fontSize: 15, fontWeight: '600', lineHeight: 23 }, kicker: { color: '#8B7E70', fontSize: 10, letterSpacing: 1.5, fontWeight: '600' }, link: { color: C.primary, fontSize: 13, fontWeight: '600' }, card: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: C.line }, pad: { padding: 16 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, chips: { gap: 8, paddingVertical: 10 }, chip: { minHeight: 44, justifyContent: 'center', borderRadius: 12, backgroundColor: '#F4EEE6', borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 8 }, button: { minHeight: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, marginTop: 12 }, label: { color: C.sub, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 7 }, input: { backgroundColor: '#fff', padding: 13, minHeight: 46, borderWidth: 1, borderColor: C.line, borderRadius: 10, color: C.ink }, menu: { paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.line }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }, tag: { fontSize: 11, color: C.sub, backgroundColor: '#F4EEE6', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 7 }, match: { position: 'absolute', top: 12, left: 12, borderRadius: 10, backgroundColor: '#fff', paddingVertical: 6, paddingHorizontal: 10, color: C.primary, fontSize: 11 }, mask: { flex: 1, backgroundColor: '#2E2A2566', justifyContent: 'flex-end', alignItems: 'center' }, sheet: { width: '100%', maxWidth: 430, maxHeight: '78%', backgroundColor: '#fff', padding: 18, borderTopLeftRadius: 18, borderTopRightRadius: 18 }, handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D7CABB', alignSelf: 'center', marginBottom: 14 }, dropdown: { backgroundColor: '#FFF9F3', borderRadius: 10, borderWidth: 1, borderColor: C.line, marginTop: 5 }, loading: { flex: 1, gap: 12, alignItems: 'center', justifyContent: 'center' }, empty: { padding: 28, textAlign: 'center', color: C.sub, fontSize: 14, lineHeight: 22 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, gridItem: { width: '31.7%', marginBottom: 12 }, meter: { height: 5, backgroundColor: C.line, borderRadius: 4, marginVertical: 8 }, avatar: { width: 34, height: 34, borderRadius: 17 }, info: { padding: 14, backgroundColor: C.soft, borderRadius: 12, marginBottom: 14 } });
