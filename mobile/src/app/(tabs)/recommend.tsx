import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Chips, C, Icon, Photo, Screen, Section, s } from '../../components/ui';
import { useStore, type Outfit } from '../../lib/store';

export default function Recommend() {
  const { catalog, state, mutate, busy, wardrobe, notify } = useStore();
  const [occasion, setOccasion] = useState('全部');
  const [planIds, setPlanIds] = useState<string[]>([]);
  const seenIds = useRef(new Set<string>());
  const plans = useMemo(() => {
    const names = new Set(wardrobe.map(item => item.name));
    return (catalog?.outfits || [])
      .filter((outfit, index, all) => (occasion === '全部' || outfit.occasion === occasion) && all.findIndex(item => item.id === outfit.id) === index)
      .map(outfit => {
        const ownedCount = outfit.items.filter(item => names.has(item.name)).length;
        return { outfit, ownedCount, coverage: outfit.items.length ? ownedCount / outfit.items.length : 0 };
      })
      .sort((a, b) => b.coverage - a.coverage || b.ownedCount - a.ownedCount || b.outfit.match - a.outfit.match);
  }, [catalog, occasion, wardrobe]);
  const selectedPlans = planIds.flatMap(id => {
    const plan = plans.find(item => item.outfit.id === id);
    return plan ? [plan] : [];
  });
  const shown = [...selectedPlans, ...plans.filter(plan => !planIds.includes(plan.outfit.id))].slice(0, 3);
  const changeOne = (outfit: Outfit) => {
    const displayedIds = new Set(shown.map(plan => plan.outfit.id));
    const candidates = plans.filter(plan => plan.outfit.occasion === outfit.occasion && !displayedIds.has(plan.outfit.id));
    if (!candidates.length) { notify('该场合暂无更多方案'); return; }
    displayedIds.forEach(id => seenIds.current.add(id));
    const replacement = candidates.find(plan => !seenIds.current.has(plan.outfit.id)) || candidates[0];
    seenIds.current.add(replacement.outfit.id);
    setPlanIds(shown.map(plan => plan.outfit.id === outfit.id ? replacement.outfit.id : plan.outfit.id));
    notify('已为你换一套搭配');
  };
  return <Screen>
    <View style={[s.card, s.pad, { backgroundColor: '#FAEEE3', borderColor: '#F0D6C5', marginBottom: 0 }]}>
      <View style={s.row}>
        <Icon name="sparkles" color={C.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[s.bold, { fontSize: 13 }]}>规则引擎已就绪</Text>
          <Text style={[s.small, { marginTop: 4 }]}>基于衣橱的 {wardrobe.length} 件单品，优先推荐已有衣物占比高的方案</Text>
          <Text style={[s.small, { fontSize: 10 }]}>已有件数按单品名称匹配，缺少的单品会在详情中展示</Text>
        </View>
      </View>
    </View>
    <Section title="选择场合" en="OCCASION" />
    <Chips values={catalog?.occasions || ['全部']} selected={occasion} onSelect={value => {
      if (value === occasion) return;
      setOccasion(value);
      setPlanIds([]);
      seenIds.current.clear();
    }} />
    <Section title="为你生成" en="LOOK PLANS" />
    {shown.map(({ outfit, ownedCount, coverage }) => {
      const percent = Math.round(coverage * 100);
      const adopted = state?.adopted.includes(outfit.id) || false;
      const detail = () => router.push({ pathname: '/set-detail', params: { id: outfit.id } });
      return <View key={outfit.id} style={s.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${outfit.title}详情`} onPress={detail}>
          <Photo uri={outfit.cover} />
          <Text style={s.match}>衣橱已有 {percent}%</Text>
        </Pressable>
        <View style={s.pad}>
          <Text style={s.bold}>{outfit.title}</Text>
          <View style={s.tags}>{outfit.tags.map(tag => <Text key={tag} style={[s.tag, { borderRadius: 20 }]}>{tag}</Text>)}</View>
          <View style={[s.between, { marginTop: 12 }]}><Text style={s.small}>衣橱匹配度</Text><Text style={[s.link, { fontSize: 11 }]}>{percent}%</Text></View>
          <View accessibilityRole="progressbar" accessibilityLabel="衣橱已有单品占比" accessibilityValue={{ min: 0, max: 100, now: percent }} style={[s.meter, { overflow: 'hidden' }]}>
            <View style={{ width: `${percent}%`, height: 5, backgroundColor: C.primary, borderRadius: 4 }} />
          </View>
          <View style={s.between}><Text style={s.small}>衣橱中已有</Text><Text style={{ fontSize: 10, color: '#5F8464', backgroundColor: '#F1F5F0', borderWidth: 1, borderColor: '#C7D5C5', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20 }}>{ownedCount} / {outfit.items.length} 件</Text></View>
          <View style={[s.row, { marginTop: 12 }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || adopted }} style={[s.button, { flex: 1, marginTop: 0, backgroundColor: adopted ? C.primary : C.soft, opacity: busy ? 0.5 : 1 }]} disabled={busy || adopted} onPress={() => void mutate(`/api/adopt/${outfit.id}`).then(ok => { if (ok) notify(`已采纳「${outfit.title}」`); })}>
              <Text style={{ color: adopted ? '#fff' : C.primary, fontWeight: '600', fontSize: 12 }}>{adopted ? '已采纳' : '采纳'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`更换${outfit.title}`} style={[s.button, { flex: 1, marginTop: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }]} onPress={() => changeOne(outfit)}><Text style={{ color: C.ink, fontWeight: '600', fontSize: 12 }}>换一套</Text></Pressable>
            <Pressable accessibilityRole="button" style={[s.button, { flex: 1, marginTop: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }]} onPress={detail}><Text style={{ color: C.ink, fontWeight: '600', fontSize: 12 }}>详情</Text></Pressable>
          </View>
        </View>
      </View>;
    })}
    {!shown.length && <Text style={s.empty}>这个场合暂时没有合适的整套推荐</Text>}
    {shown.length > 0 && plans.length <= 3 && <Text style={[s.empty, { paddingVertical: 18 }]}>该场合暂无更多方案</Text>}
  </Screen>;
}
