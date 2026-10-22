import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Button, Chips, C, Field, Icon, Photo, Screen, Sheet, s } from '../../components/ui';
import { filterByAudience, json, request, useStore, type WardrobeItem } from '../../lib/store';

import SavedSets from '../../components/saved-sets';

const seasons = ['未标注', '春', '夏', '秋', '冬', '四季'];
const styles = ['未标注', '简约', '通勤', '休闲', '运动', '优雅', '复古'];
const usageFilters = ['全部穿着', '常穿（≥5次）', '未穿（0次）', '低使用（1–2次）'];
const options = (all: string, values: (string | undefined)[]) => [all, '未标注', ...new Set(values.filter((value): value is string => !!value && value !== '未标注'))];
const matches = (value: string | undefined, filter: string, all: string) => filter === all || (value || '未标注') === filter;

export default function Wardrobe() {
  const { user, wardrobe, catalog, mutate, busy, notify, dismiss } = useStore();
  const [tab, setTab] = useState('我的单品');
  const [cat, setCat] = useState('全部');
  const [fineCat, setFineCat] = useState('全部');
  const [search, setSearch] = useState('');
  const [colorFilter, setColorFilter] = useState('全部颜色');
  const [seasonFilter, setSeasonFilter] = useState('全部季节');
  const [styleFilter, setStyleFilter] = useState('全部风格');
  const [usageFilter, setUsageFilter] = useState('全部穿着');
  const [sort, setSort] = useState('最近添加');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [preview, setPreview] = useState<WardrobeItem | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WardrobeItem | null>(null);
  const [removing, setRemoving] = useState<WardrobeItem | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('上装');
  const [categoryBroad, setCategoryBroad] = useState('上装');
  const [color, setColor] = useState('');
  const [season, setSeason] = useState('未标注');
  const [style, setStyle] = useState('未标注');
  const [image, setImage] = useState('');
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const samples = filterByAudience(catalog?.wardrobeSamples || [], user);
  const isPreview = wardrobe.length === 0 && samples.length > 0;
  const items: WardrobeItem[] = isPreview ? samples.map(({ id, name, category, image_url, color, season, style }) => ({ id, name, category, image_url, color, season, style, wear_count: 0 })) : wardrobe;
  const activeFilters = [colorFilter !== '全部颜色', seasonFilter !== '全部季节', styleFilter !== '全部风格', usageFilter !== '全部穿着', sort !== '最近添加'].filter(Boolean).length;
  const categoryGroups = useMemo(() => catalog?.categoryGroups || {}, [catalog?.categoryGroups]);
  const fineCategorySet = new Set(Object.values(categoryGroups).flat());
  const categories = [...new Set([...(catalog?.cats || ['全部', '上装', '下装', '外套', '连衣裙', '鞋履', '配饰']), ...items.map(item => item.category)])];
  const broadCategories = ['全部', ...categories.filter(value => value !== '全部' && !fineCategorySet.has(value))];
  const fineCategories = cat === '全部' ? [] : categoryGroups[cat] || [];
  const shown = useMemo(() => items.filter(item =>
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
    (fineCat !== '全部' ? item.category === fineCat : cat === '全部' || item.category === cat || (categoryGroups[cat] || []).includes(item.category)) &&
    matches(item.color, colorFilter, '全部颜色') && matches(item.season, seasonFilter, '全部季节') && matches(item.style, styleFilter, '全部风格') &&
    (usageFilter === usageFilters[0] || (usageFilter === usageFilters[1] && item.wear_count >= 5) ||
      (usageFilter === usageFilters[2] && item.wear_count === 0) || (usageFilter === usageFilters[3] && item.wear_count >= 1 && item.wear_count <= 2))
  ).sort((a, b) => sort === '穿着最多' ? b.wear_count - a.wear_count : sort === '穿着最少' ? a.wear_count - b.wear_count : sort === '名称排序' ? a.name.localeCompare(b.name, 'zh-CN') : 0), [items, search, cat, fineCat, categoryGroups, colorFilter, seasonFilter, styleFilter, usageFilter, sort]);
  const worn = wardrobe.filter(item => item.wear_count > 0).length;
  const resetFilters = () => { setSearch(''); setCat('全部'); setFineCat('全部'); setColorFilter('全部颜色'); setSeasonFilter('全部季节'); setStyleFilter('全部风格'); setUsageFilter('全部穿着'); setSort('最近添加'); };
  const importSamples = async () => {
    if (savingRef.current || busy) return;
    savingRef.current = true; setSaving(true); dismiss();
    try {
      if (await mutate('/api/wardrobe/import-samples')) {
        setPreview(null); resetFilters(); notify('样例导入已完成，未重复添加。可以编辑、记录穿着或删除。');
      }
    } finally { savingRef.current = false; setSaving(false); }
  };
  const start = (item: WardrobeItem | null = null) => {
    const parent = item && Object.entries(categoryGroups).find(([, children]) => children.includes(item.category))?.[0];
    const nextBroad = parent || item?.category || '上装';
    dismiss(); setEditing(item); setName(item?.name || ''); setCategoryBroad(nextBroad); setCategory(item?.category || nextBroad);
    setColor(item?.color || ''); setSeason(item?.season || '未标注'); setStyle(item?.style || '未标注');
    setImage(item?.image_url || ''); setPicked(null); setOpen(true);
  };
  const pick = async (camera: boolean) => {
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { notify(permission.canAskAgain ? '需要相机权限才能拍照，请重试并允许访问。也可以从相册添加。' : '相机权限已关闭，请在系统设置中允许访问，或从相册添加。'); return; }
      }
      const config: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: Platform.OS !== 'web', aspect: [1, 1], quality: 0.85 };
      const result = await (camera ? ImagePicker.launchCameraAsync(config) : ImagePicker.launchImageLibraryAsync(config));
      if (!result.canceled && result.assets[0]) setPicked(result.assets[0]);
    } catch (error) { notify(`无法打开图片：${(error as Error).message}。可以重试或换用相册。`); }
  };
  const save = async () => {
    if (savingRef.current || busy) return;
    if (!name.trim() || name.trim().length > 80 || !category.trim() || category.trim().length > 30 || color.trim().length > 30 || season.length > 30 || style.length > 30) { notify('名称需为1–80字，分类需为1–30字，其他字段最多30字。'); return; }
    savingRef.current = true; setSaving(true);
    try {
      let imageUrl = image;
      if (picked) {
        const form = new FormData();
        if (Platform.OS === 'web') {
          const response = await fetch(picked.uri);
          if (!response.ok) throw new Error('无法读取所选图片');
          const blob = await response.blob();
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('请选择 JPG、PNG 或 WEBP 图片');
          form.append('file', blob, picked.fileName || 'wardrobe.jpg');
        } else {
          const mime = picked.mimeType || 'image/jpeg';
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('请选择 JPG、PNG 或 WEBP 图片');
          form.append('file', { uri: picked.uri, name: `wardrobe.${mime.split('/')[1]}`, type: mime } as unknown as Blob);
        }
        imageUrl = (await request<{ image_url: string }>('/api/uploads', { method: 'POST', body: form })).image_url;
        setImage(imageUrl); setPicked(null);
      }
      const payload = { name: name.trim(), category: category.trim(), color: color.trim(), season: season === '未标注' ? '' : season, style: style === '未标注' ? '' : style, image_url: imageUrl || null };
      if (await mutate(editing ? `/api/wardrobe/${editing.id}` : '/api/wardrobe', json(payload, editing ? 'PUT' : 'POST'))) {
        setOpen(false); notify(editing ? '衣物修改已保存' : '单品已加入衣橱');
      }
    } catch (error) { notify((error as Error).message); } finally { savingRef.current = false; setSaving(false); }
  };
  return <Screen>
    <View style={{ paddingTop: 4, paddingBottom: 12 }}>
      <View style={s.between}><View style={{ flex: 1 }}><Text style={s.title}>{user?.name ? `${user.name}的衣橱` : '我的衣橱'}</Text><Text style={[s.small, { marginTop: 4 }]}>把喜欢的衣物收进来，搭配从今天开始</Text></View><Text style={s.tag}>衣橱</Text></View>
    </View>
    <View style={{ flexDirection: 'row', paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, marginBottom: 6 }}>{[
      { value: wardrobe.length, label: '单品数' },
      { value: wardrobe.reduce((sum, item) => sum + item.wear_count, 0), label: '累计穿着次数' },
      { value: `${wardrobe.length ? Math.round(worn / wardrobe.length * 100) : 0}%`, label: '穿过单品占比' },
    ].map((stat, index) => <View key={stat.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: index ? 1 : 0, borderLeftColor: C.line }}><Text style={s.title}>{stat.value}</Text><Text style={s.small}>{stat.label}</Text></View>)}</View>
    <Chips values={['我的单品', '我的套装']} selected={tab} onSelect={setTab} />
    {tab === '我的套装' ? <SavedSets key={user?.phone} /> : <>
    <View style={[s.between, { marginTop: 8 }]}><Text style={s.title}>我的单品</Text><Pressable accessibilityRole="button" accessibilityLabel="添加单品" disabled={busy || saving} onPress={() => start()} style={[s.row, { padding: 12, borderRadius: 24, backgroundColor: C.soft }]}><Icon name="plus" color={C.primary} /><Text style={s.link}>添加</Text></Pressable></View>
    <View style={[s.row, { marginTop: 12 }]}>
      <TextInput accessibilityLabel="搜索衣物名称" placeholder="搜索衣物名称" placeholderTextColor={C.sub} value={search} onChangeText={setSearch} style={[s.input, { flex: 1, minWidth: 0 }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={`筛选与排序，已激活${activeFilters}项`} onPress={() => { dismiss(); setFiltersOpen(true); }} style={[s.row, s.input, { backgroundColor: activeFilters ? C.soft : '#fff' }]}><Icon name="settings" color={C.primary} /><Text style={s.link}>筛选{activeFilters ? ` ${activeFilters}` : ''}</Text></Pressable>
    </View>
    <Chips values={broadCategories} selected={cat} onSelect={value => { setCat(value); setFineCat('全部'); }} />
    {!!fineCategories.length && <Chips values={['全部', ...fineCategories]} selected={fineCat} onSelect={setFineCat} />}
    <View style={s.between}><Text style={s.small}>{isPreview ? '示例预览' : '我的衣物'} · {shown.length} / {items.length} 件</Text>{!!(activeFilters || search || cat !== '全部' || fineCat !== '全部') && <Pressable accessibilityRole="button" onPress={resetFilters} style={{ padding: 12 }}><Text style={s.link}>清空条件</Text></Pressable>}</View>
    {isPreview && <View style={[s.info, { marginTop: 12 }]}><Text style={s.bold}>先逛逛这 {samples?.length || 0} 件示例单品</Text><Text style={s.small}>仅供预览，不计入上方统计或推荐。导入后成为你的衣物，穿着次数从 0 开始。</Text><Button title={saving ? '正在导入…' : '一键导入样例到我的衣橱'} disabled={busy || saving} onPress={() => void importSamples()} /></View>}
    <View style={[s.grid, { marginTop: 12, gap: 12 }]}>{shown.map(item => <View key={item.id} style={{ width: '47%', flexGrow: 1, maxWidth: '50%', marginBottom: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${isPreview ? '预览示例' : '编辑'}${item.name}`} disabled={busy || saving} onPress={() => isPreview ? setPreview(item) : start(item)}>
        <View style={{ borderRadius: 10, overflow: 'hidden' }}><Photo uri={item.image_url || undefined} square /></View>
        <Text numberOfLines={2} style={[s.bold, { fontSize: 13, marginTop: 6 }]}>{item.name}</Text>
        <Text numberOfLines={2} style={s.small}>{[item.category, item.color, item.season, item.style].filter(Boolean).join(' · ')}</Text>
        <Text style={s.small}>{isPreview ? '示例 · 点击预览' : `穿过 ${item.wear_count} 次 · 编辑`}</Text>
      </Pressable>
      {!isPreview && <View style={s.between}><Pressable accessibilityRole="button" accessibilityLabel={`记录${item.name}穿一次`} style={{ paddingVertical: 12 }} disabled={busy || saving} onPress={() => void mutate(`/api/wardrobe/${item.id}/wear`, { method: 'PUT' })}><Text style={s.link}>穿一次</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`删除${item.name}`} style={{ paddingVertical: 12 }} disabled={busy || saving} onPress={() => { dismiss(); setRemoving(item); }}><Text style={s.small}>删除</Text></Pressable></View>}
    </View>)}</View>
    {!shown.length && <View style={[s.card, s.pad]}><Text style={s.empty}>{items.length ? '没有符合条件的单品，试试减少筛选条件。' : !wardrobe.length && catalog?.wardrobeSamples?.length ? '当前穿搭偏好下暂无可预览的样例，可修改个人资料偏好或手动添加衣物。' : '这里还没有单品，添加衣物开启日常穿搭。'}</Text>{!!items.length && <Button title="重置筛选，查看全部" soft onPress={resetFilters} />}</View>}
    {!isPreview && !!samples?.length && <Pressable accessibilityRole="button" disabled={busy || saving} onPress={() => void importSamples()} style={{ padding: 12, alignItems: 'center' }}><Text style={s.link}>{saving ? '正在导入…' : '导入样例体验搭配（仅添加一次）'}</Text></Pressable>}
    <Button title="去生成整套推荐" soft onPress={() => router.push('/recommend')} />
    </>}
    <Sheet title={`筛选与排序${activeFilters ? ` · ${activeFilters} 项` : ''}`} visible={filtersOpen} onClose={() => setFiltersOpen(false)}>
      <Text style={[s.small, { marginTop: 12 }]}>选择后即时生效 · 当前找到 {shown.length} 件{isPreview ? '示例' : '单品'}</Text>
      <Text style={s.label}>颜色</Text><Chips values={options('全部颜色', items.map(item => item.color))} selected={colorFilter} onSelect={setColorFilter} />
      <Text style={s.label}>季节</Text><Chips values={options('全部季节', items.map(item => item.season))} selected={seasonFilter} onSelect={setSeasonFilter} />
      <Text style={s.label}>风格</Text><Chips values={options('全部风格', items.map(item => item.style))} selected={styleFilter} onSelect={setStyleFilter} />
      <Text style={s.label}>穿着使用</Text><Chips values={usageFilters} selected={usageFilter} onSelect={setUsageFilter} />
      <Text style={s.label}>排序</Text><Chips values={['最近添加', '穿着最多', '穿着最少', '名称排序']} selected={sort} onSelect={setSort} />
      <Button title={`查看 ${shown.length} 件${isPreview ? '示例' : '单品'}`} onPress={() => setFiltersOpen(false)} />
      <Button title="清空全部条件" soft onPress={resetFilters} />
    </Sheet>
    <Sheet title="示例单品预览" visible={!!preview} onClose={() => { if (!savingRef.current && !busy) setPreview(null); }}>
      {preview && <><Photo uri={preview.image_url || undefined} square /><Text style={[s.bold, { marginTop: 12 }]}>{preview.name}</Text><Text style={s.body}>{[preview.category, preview.color, preview.season, preview.style].join(' · ')}</Text><Text style={[s.small, { marginTop: 8 }]}>示例图片与资料，尚未加入你的衣橱。导入全部 {samples?.length || 0} 件后，可编辑、记录穿着、删除，并查看基于衣橱的推荐。</Text><Button title={saving ? '正在导入…' : '导入全部样例到我的衣橱'} disabled={busy || saving} onPress={() => void importSamples()} /></>}
    </Sheet>
    <Sheet title={editing ? '编辑衣物' : '添加衣物'} visible={open} onClose={() => { if (!savingRef.current && !busy) setOpen(false); }}>
      <Photo uri={picked?.uri || image || undefined} />
      <Button title={Platform.OS === 'web' ? '拍照 / 浏览器选择' : '拍照添加'} disabled={saving || busy} soft onPress={() => void pick(true)} />
      <Button title="从相册选择" disabled={saving || busy} soft onPress={() => void pick(false)} />
      <Text style={[s.small, { marginTop: 8 }]}>{Platform.OS === 'web' ? 'Web 不提供裁剪；拍照入口由浏览器和设备决定，可能打开文件选择器。支持 JPG、PNG、WEBP。' : '选择或拍照后可使用系统裁剪；支持 JPG、PNG、WEBP。'}</Text>
      {!!(picked || image) && <Button title="移除图片" disabled={saving || busy} soft onPress={() => { setPicked(null); setImage(''); }} />}
      <Field label="单品名称（必填，最多80字）" value={name} onChangeText={setName} />
      <Text style={s.label}>大类（必填）</Text><Chips values={broadCategories.filter(value => value !== '全部')} selected={categoryBroad} onSelect={value => { setCategoryBroad(value); setCategory(value); }} />
      <Text style={s.label}>细分类</Text><Chips values={['使用大类', ...(categoryGroups[categoryBroad] || [])]} selected={category === categoryBroad ? '使用大类' : category} onSelect={value => setCategory(value === '使用大类' ? categoryBroad : value)} />
      <Field label="颜色（选填，最多30字）" value={color} onChangeText={setColor} />
      <Text style={s.label}>季节</Text><Chips values={[...new Set([...seasons, season])]} selected={season} onSelect={setSeason} />
      <Text style={s.label}>风格</Text><Chips values={[...new Set([...styles, style])]} selected={style} onSelect={setStyle} />
      {editing && <Text style={[s.small, { marginTop: 12 }]}>已记录穿着 {editing.wear_count} 次，编辑资料会保留穿着次数。</Text>}
      <Button title={saving ? '正在保存…' : editing ? '保存修改' : '保存到衣橱'} onPress={() => void save()} disabled={!name.trim() || busy || saving} />
    </Sheet>
    <Sheet title="删除单品" visible={!!removing} onClose={() => { if (!busy) setRemoving(null); }}>
      <Text style={s.body}>确认从衣橱移除「{removing?.name}」？衣物资料与穿着次数将一起移除。</Text>
      <Button title="确认删除" disabled={busy} onPress={() => { if (removing) void mutate(`/api/wardrobe/${removing.id}`, { method: 'DELETE' }).then(ok => { if (ok) { setRemoving(null); notify('单品已删除'); } }); }} />
      <Button title="保留单品" soft disabled={busy} onPress={() => setRemoving(null)} />
    </Sheet>
  </Screen>;
}
