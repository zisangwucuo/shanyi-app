import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button, Chips, C, Field, Icon, Photo, Screen, Select, Sheet, s } from '../../components/ui';
import { request, useStore, type WardrobeItem } from '../../lib/store';
import { router } from 'expo-router';

export default function Wardrobe() {
  const { user, wardrobe, catalog, state, mutate, busy, notify } = useStore();
  const [cat, setCat] = useState('全部'); const [colorFilter, setColorFilter] = useState('全部颜色'); const [sort, setSort] = useState('最近添加'); const [add, setAdd] = useState(false); const [removing, setRemoving] = useState<WardrobeItem | null>(null);
  const [name, setName] = useState(''); const [category, setCategory] = useState('上装'); const [color, setColor] = useState(''); const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset | null>(null); const [saving, setSaving] = useState(false);
  const shown = useMemo(() => wardrobe.filter(x => (cat === '全部' || x.category === cat) && (colorFilter === '全部颜色' || x.color === colorFilter)).sort((a, b) => sort === '穿着最多' ? b.wear_count - a.wear_count : sort === '穿着最少' ? a.wear_count - b.wear_count : 0), [wardrobe, cat, colorFilter, sort]);
  const wornItems = wardrobe.filter(item => item.wear_count > 0).length;
  const usage = wardrobe.length ? Math.round(wornItems / wardrobe.length * 100) : 0;
  const pick = async () => { try { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.85 }); if (!result.canceled) setPicked(result.assets[0]); } catch (e) { notify((e as Error).message); } };
  const create = async () => {
    if (saving || busy || !name.trim()) return; setSaving(true);
    try {
      let image = '';
      if (picked) {
        const form = new FormData();
        if (Platform.OS === 'web') { const response = await fetch(picked.uri); if (!response.ok) throw new Error('无法读取所选图片'); const blob = await response.blob(); if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('请选择 JPG、PNG 或 WEBP 图片'); form.append('file', blob, picked.fileName || 'wardrobe.jpg'); }
        else { const mime = picked.mimeType || 'image/jpeg'; if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('请选择 JPG、PNG 或 WEBP 图片'); form.append('file', { uri: picked.uri, name: picked.fileName || `wardrobe.${mime.split('/')[1]}`, type: mime } as unknown as Blob); }
        image = (await request<{ image_url: string }>('/api/uploads', { method: 'POST', body: form })).image_url;
      }
      const query = new URLSearchParams({ name: name.trim(), category, color }); if (image) query.set('image_url', image);
      if (await mutate(`/api/wardrobe?${query}`)) { setAdd(false); setName(''); setColor(''); setPicked(null); notify('单品已加入衣橱'); }
    } catch (e) { notify((e as Error).message); } finally { setSaving(false); }
  };
  return <Screen>
    <View style={[s.card, s.pad, { backgroundColor: '#FAEEE3', borderColor: '#F0D6C5', marginBottom: 12 }]}><View style={s.between}><View style={{ flex: 1 }}><Text style={[s.title, { fontSize: 20, fontWeight: '600' }]}>{user?.name ? `${user.name}的衣橱` : '我的衣橱'}</Text><Text style={[s.small, { marginTop: 4 }]}>把喜欢的衣物收进来，搭配从今天开始</Text></View><Text style={{ color: C.primary, backgroundColor: C.soft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, fontSize: 11 }}>衣橱</Text></View></View>
    <View style={[s.card, { flexDirection: 'row', paddingVertical: 14, marginBottom: 0 }]}>{[
      { value: wardrobe.length, label: '单品数' },
      { value: state?.adopted.length || 0, label: '已采纳套数' },
      { value: `${usage}%`, label: '穿过单品占比' },
    ].map((stat, index) => <View key={stat.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: index ? 1 : 0, borderLeftColor: C.line }}><Text style={[s.title, { fontSize: 20, fontWeight: '600' }]}>{stat.value}</Text><Text style={[s.small, { fontSize: 10, marginTop: 2 }]}>{stat.label}</Text></View>)}</View>
    <View style={[s.between, { marginTop: 22 }]}><View style={s.row}><Text style={s.title}>我的单品</Text><Text style={s.kicker}>WARDROBE</Text></View><Pressable accessibilityRole="button" accessibilityLabel="添加单品" onPress={() => setAdd(true)} style={{ padding: 10, borderRadius: 24, backgroundColor: C.soft }}><Icon name="plus" color={C.primary} /></Pressable></View>
    <Chips values={catalog?.cats || ['全部']} selected={cat} onSelect={setCat} /><View style={s.row}><View style={{ flex: 1 }}><Select label="按颜色" values={['全部颜色', ...new Set(wardrobe.map(x => x.color).filter(Boolean))]} selected={colorFilter} onSelect={setColorFilter} /></View><View style={{ flex: 1 }}><Select label="排序" values={['最近添加', '穿着最多', '穿着最少']} selected={sort} onSelect={setSort} /></View></View>
    <View style={[s.grid, { marginTop: 18 }]}>{shown.map(item => <View key={item.id} style={s.gridItem}><View style={{ borderRadius: 10, overflow: 'hidden' }}><Photo uri={item.image_url} square /><Text style={{ position: 'absolute', right: 6, top: 6, color: '#fff', backgroundColor: '#221E1A99', borderRadius: 14, paddingHorizontal: 7, paddingVertical: 3, fontSize: 10 }}>穿过 {item.wear_count} 次</Text></View><Text numberOfLines={1} style={[s.bold, { fontSize: 12, marginTop: 6 }]}>{item.name}</Text><Text numberOfLines={1} style={[s.small, { fontSize: 10 }]}>{item.color || '未标色'}</Text><View style={s.between}><Pressable accessibilityRole="button" accessibilityLabel={`记录${item.name}穿一次`} style={{ paddingVertical: 10 }} disabled={busy} onPress={() => void mutate(`/api/wardrobe/${item.id}/wear`, { method: 'PUT' })}><Text style={s.link}>穿一次</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`删除${item.name}`} style={{ paddingVertical: 10 }} disabled={busy} onPress={() => setRemoving(item)}><Text style={s.small}>删除</Text></Pressable></View></View>)}</View>
    {!shown.length && <Text style={s.empty}>{wardrobe.length ? '当前筛选下没有单品，试试其他分类或颜色。' : '这里还没有单品。添加衣物，开始记录你的日常穿搭。'}</Text>}
    <Button title="＋  添加单品" onPress={() => setAdd(true)} /><View style={{ marginTop: 4 }}><Button title="去生成整套推荐　✦" soft onPress={() => router.push('/recommend')} /></View>
    <Sheet title="添加衣物" visible={add} onClose={() => { if (!saving) setAdd(false); }}><Pressable onPress={() => void pick()}>{picked ? <Photo uri={picked.uri} /> : <Text style={s.empty}>点击选择 JPG / PNG / WEBP 照片</Text>}</Pressable><Field label="单品名称" value={name} onChangeText={setName} /><Select label="分类" values={catalog?.cats.slice(1) || ['上装']} selected={category} onSelect={setCategory} /><Field label="颜色" value={color} onChangeText={setColor} /><Button title={saving ? '正在保存…' : '保存到衣橱'} onPress={() => void create()} disabled={!name.trim() || busy || saving} /></Sheet><Sheet title="删除单品" visible={!!removing} onClose={() => setRemoving(null)}><Text style={s.body}>确认从衣橱移除「{removing?.name}」？</Text><Button title="确认删除" disabled={busy} onPress={() => { if (removing) void mutate(`/api/wardrobe/${removing.id}`, { method: 'DELETE' }).then(ok => { if (ok) setRemoving(null); }); }} /></Sheet>
  </Screen>;
}
