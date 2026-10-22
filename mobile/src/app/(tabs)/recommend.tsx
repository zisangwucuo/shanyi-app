import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Chips, C, OutfitCard, Screen, s } from '../../components/ui';
import { useStore, type Outfit } from '../../lib/store';

const PAGE_SIZE = 6;

export default function Recommend() {
  const { user, catalog, recommendations, state, activity, mutate, busy, wardrobe, notify } = useStore();
  const [occasion, setOccasion] = useState('全部');
  const [style, setStyle] = useState('全部');
  const [season, setSeason] = useState('全部');
  const [filterGroup, setFilterGroup] = useState<'场合' | '风格' | '季节'>('场合');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scope = JSON.stringify([user?.phone, user?.gender, user?.outfit_preference, occasion, style, season, activity.feedback, activity.records.map(record => record.id), wardrobe.map(({ id, name, category, color }) => [id, name, category, color]).sort((a, b) => a[0].localeCompare(b[0]))]);
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const planIds = selection.scope === scope ? selection.ids : [];
  const seenIds = useRef({ scope: '', ids: new Set<string>() });
  const plans = useMemo(() => recommendations.filter(({ outfit }) =>
    (occasion === '全部' || outfit.occasion === occasion) &&
    (style === '全部' || outfit.style === style) &&
    (season === '全部' || outfit.season === season)
  ), [recommendations, occasion, style, season]);
  const selectedPlans = planIds.flatMap(id => {
    const plan = plans.find(item => item.outfit.id === id);
    return plan ? [plan] : [];
  });
  const shown = [...selectedPlans, ...plans.filter(plan => !planIds.includes(plan.outfit.id))].slice(0, visibleCount);
  const resetBrowsing = () => {
    setVisibleCount(PAGE_SIZE);
    setSelection({ scope: '', ids: [] });
    seenIds.current = { scope: '', ids: new Set<string>() };
  };
  const changeFilter = (setValue: (value: string) => void, current: string, value: string) => {
    if (value === current) return;
    setValue(value);
    resetBrowsing();
  };
  const changeOne = (outfit: Outfit) => {
    if (seenIds.current.scope !== scope) seenIds.current = { scope, ids: new Set<string>() };
    const displayedIds = new Set(shown.map(plan => plan.outfit.id));
    const candidates = plans.filter(plan => !displayedIds.has(plan.outfit.id));
    if (!candidates.length) { notify('当前筛选下暂无更多搭配'); return; }
    displayedIds.forEach(id => seenIds.current.ids.add(id));
    const replacement = candidates.find(plan => !seenIds.current.ids.has(plan.outfit.id)) || candidates[0];
    seenIds.current.ids.add(replacement.outfit.id);
    setSelection({ scope, ids: shown.map(plan => plan.outfit.id === outfit.id ? replacement.outfit.id : plan.outfit.id) });
    notify('已为你换一套搭配');
  };
  const occasions = ['全部', ...(catalog?.occasions || []).filter(value => value !== '全部')];
  const styles = ['全部', ...new Set(recommendations.map(({ outfit }) => outfit.style).filter((value): value is string => !!value))];
  const seasons = ['全部', ...new Set(recommendations.map(({ outfit }) => outfit.season).filter((value): value is string => !!value))];
  return <Screen>
    <Text style={s.kicker}>OUTFIT LIBRARY</Text>
    <Text style={[s.title, { fontSize: 27, marginTop: 7 }]}>搭配灵感库</Text>
    <Text style={[s.small, { marginTop: 8 }]}>按场合、风格与季节筛选，浏览完整搭配参考与衣橱匹配情况。</Text>
    <View style={[s.between, { marginTop: 22, marginBottom: 4 }]}>
      <Text style={s.label}>筛选条件</Text>
      {(occasion !== '全部' || style !== '全部' || season !== '全部') && <Pressable accessibilityRole="button" onPress={() => { setOccasion('全部'); setStyle('全部'); setSeason('全部'); resetBrowsing(); }} style={{ padding: 8 }}><Text style={s.link}>清空</Text></Pressable>}
    </View>
    <View style={[s.row, { gap: 6 }]}>
      {(['场合', '风格', '季节'] as const).map(group => {
        const value = group === '场合' ? occasion : group === '风格' ? style : season;
        return <Pressable key={group} accessibilityRole="button" accessibilityLabel={`${group}筛选，当前${value}`} accessibilityState={{ expanded: filterGroup === group }} onPress={() => setFilterGroup(group)} style={{ flex: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12, backgroundColor: filterGroup === group ? C.soft : '#F4EEE6', borderWidth: 1, borderColor: filterGroup === group ? '#D8AD95' : C.line }}>
          <Text style={{ color: filterGroup === group ? C.primary : C.sub, fontSize: 11 }}>{group}</Text>
          <Text numberOfLines={1} style={{ color: filterGroup === group ? C.primary : C.ink, fontSize: 14, fontWeight: '600', marginTop: 2 }}>{value}</Text>
        </Pressable>;
      })}
    </View>
    <Chips values={filterGroup === '场合' ? occasions : filterGroup === '风格' ? styles : seasons} selected={filterGroup === '场合' ? occasion : filterGroup === '风格' ? style : season} onSelect={value => filterGroup === '场合' ? changeFilter(setOccasion, occasion, value) : filterGroup === '风格' ? changeFilter(setStyle, style, value) : changeFilter(setSeason, season, value)} />
    <View style={[s.between, { marginTop: 4, marginBottom: 10 }]}>
      <Text style={s.bold}>符合条件 · {plans.length} 套</Text>
    </View>
    {shown.map(({ outfit }) => {
      const collected = state?.likes.includes(`outfit:${outfit.id}`) || false;
      return <OutfitCard key={outfit.id} outfit={outfit}>
        <Pressable accessibilityRole="button" accessibilityLabel={collected ? `取消收藏${outfit.title}` : `收藏${outfit.title}`} accessibilityState={{ disabled: busy, selected: collected }} style={[s.button, { flex: 1, marginTop: 0, backgroundColor: collected ? C.primary : C.soft, opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void mutate(`/api/likes/outfit:${outfit.id}`).then(ok => { if (ok) notify(`${collected ? '已取消收藏' : '已收藏'}「${outfit.title}」`); })}>
          <Text style={{ color: collected ? '#fff' : C.primary, fontWeight: '600', fontSize: 12 }}>{collected ? '已收藏' : '收藏'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`更换${outfit.title}`} style={[s.button, { flex: 1, marginTop: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }]} onPress={() => changeOne(outfit)}><Text style={{ color: C.ink, fontWeight: '600', fontSize: 12 }}>换一套</Text></Pressable>
      </OutfitCard>;
    })}
    {!plans.length && <Text style={s.empty}>暂无符合条件的搭配，调整场合、风格或季节再试试。</Text>}
    {shown.length < plans.length && <Pressable accessibilityRole="button" onPress={() => setVisibleCount(count => Math.min(count + PAGE_SIZE, plans.length))} style={[s.button, { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }]}><Text style={s.link}>继续浏览 · 再看 {Math.min(PAGE_SIZE, plans.length - shown.length)} 套</Text></Pressable>}
  </Screen>;
}
