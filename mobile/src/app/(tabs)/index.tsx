import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chips, C, Icon, OutfitCard, Screen, Section, s } from '../../components/ui';
import { useStore } from '../../lib/store';

export default function Home() {
  const { user, catalog, state, notify } = useStore();
  const [occasion, setOccasion] = useState('全部');
  const [offset, setOffset] = useState(0);
  const [now] = useState(() => Date.now());
  const outfits = useMemo(() => (catalog?.outfits || []).filter(x => occasion === '全部' || x.occasion === occasion), [catalog, occasion]);
  const start = offset % Math.max(outfits.length, 1);
  const shown = [...outfits.slice(start), ...outfits.slice(0, start)];
  const member = !!state?.member_until && new Date(state.member_until).getTime() > now;

  return <Screen>
    <View style={[s.card, home.greeting]}>
      <View style={s.between}>
        <Text style={[s.title, home.name]}>早安，{user?.name || '朋友'}</Text>
        <Text style={home.member}>{member ? '会员' : '普通用户'}</Text>
      </View>
      <View style={[s.row, { marginTop: 8 }]}>
        <Icon name="sun" color={C.primary} />
        <Text style={[s.small, { flex: 1 }]}>{user?.city || '所在城市'} · 天气示例，今天也为已有衣物找到新组合。</Text>
      </View>
    </View>
    <Chips values={['全部', ...(catalog?.occasions || []).filter(value => value !== '全部')]} selected={occasion} onSelect={value => { setOccasion(value); setOffset(0); }} />
    {shown.length ? <>
      <Section title="今日主推" en="DAILY PICK" />
      <OutfitCard outfit={shown[0]} />
      {shown.length > 1 && <>
        <Section title="为你推荐" en="FOR YOU" />
        {shown.slice(1).map(outfit => <OutfitCard key={outfit.id} outfit={outfit} />)}
      </>}
      <Pressable accessibilityRole="button" style={({ pressed }) => [s.button, home.shuffle, { opacity: pressed ? 0.7 : 1 }]} onPress={() => {
        setOffset(value => (value + 1) % Math.max(outfits.length, 1));
        notify(outfits.length > 1 ? '已为你换一批搭配' : '当前场合仅有这一套搭配，试试其他场合吧');
      }}>
        <Text style={[s.bold, { fontSize: 13 }]}>换一批</Text>
      </Pressable>
    </> : <View style={home.empty}>
      <Icon name="shirt" />
      <Text style={s.empty}>该场合暂无推荐，先去衣橱添加单品</Text>
      <Pressable accessibilityRole="button" onPress={() => router.navigate('/wardrobe')}><Text style={s.link}>去衣橱看看 →</Text></Pressable>
    </View>}
  </Screen>;
}

const home = StyleSheet.create({
  greeting: { paddingVertical: 16, paddingHorizontal: 16, backgroundColor: '#F6E3D8', marginBottom: 0 },
  name: { flex: 1, fontSize: 20, fontWeight: '600' },
  member: { fontSize: 9, letterSpacing: 1.5, color: '#F3E9DA', backgroundColor: '#4A3F35', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  shuffle: { backgroundColor: '#fff', borderColor: C.line, borderWidth: 1, marginTop: 16 },
  empty: { alignItems: 'center', paddingVertical: 44 },
});
