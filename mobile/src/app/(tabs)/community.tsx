import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, Share, Text, TextInput, View } from 'react-native';
import { Button, C, Chips, Icon, Photo, Screen, Section, Sheet, s } from '../../components/ui';
import { asset, json, useStore, type Post, type SavedSet } from '../../lib/store';
import { SetImages } from '../../components/saved-sets';

export default function Community() {
  const { catalog, state, sharedSets, mutate, busy, notify } = useStore();
  const [shared, setShared] = useState<SavedSet | null>(null);
  const [sort, setSort] = useState('全部');
  const [selected, setSelected] = useState<Post | null>(null);
  const [comment, setComment] = useState('');
  const posts = useMemo(() => {
    const list = [...(catalog?.posts || [])];
    if (sort === '热门') return list.sort((a, b) => b.likes - a.likes);
    if (sort === '最新') return list.reverse();
    return list;
  }, [catalog, sort]);
  const relatedOutfit = catalog?.outfits.find(outfit => outfit.id === selected?.outfitId);
  const openNote = (post: Post) => { setComment(''); setSelected(post); };
  const poll = catalog?.poll;
  const vote = state?.vote;
  const totalVotes = poll?.options.reduce((sum, option) => sum + option.count, 0) || 0;
  const sharePost = async (post: Post) => {
    try {
      await Share.share({ message: `${post.title}｜善衣穿搭社区` });
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const sendComment = async () => {
    if (!selected || !comment.trim()) return;
    const ok = await mutate(`/api/comments/${selected.id}`, json({ text: comment.trim() }));
    if (ok) {
      setComment('');
      notify('评论已发布');
    }
  };
  return <Screen>
    <Text style={s.kicker}>COMMUNITY</Text>
    <Text style={[s.title, { fontSize: 27, marginTop: 7 }]}>穿搭社区</Text>
    <View style={[s.info, { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }]}>
      <Icon name="users" color={C.primary} />
      <Text style={[s.small, { flex: 1 }]}>在衣橱「我的套装」中保存搭配，确认分享后会展示在这里。</Text>
    </View>
    <Section title="大家分享的套装" en="SHARED SETS" />
    <Text style={s.small}>用户主动分享的衣橱搭配 · 按发布时间排序</Text>
    {sharedSets.map(value => <Pressable key={value.id} accessibilityRole="button" style={[s.card, s.pad]} onPress={() => setShared(value)}>
      <Text style={s.bold}>{value.name}</Text><Text style={s.small}>{value.author} · {new Date(value.created_at).toLocaleDateString('zh-CN')}</Text>
      <SetImages items={value.items.slice(0, 3)} /><Text style={s.link}>{value.items.length} 件单品 · 查看整套 →</Text>
    </Pressable>)}
    {!sharedSets.length && <Text style={s.empty}>还没有人分享套装。保存自己的搭配后，可以选择分享到社区。</Text>}
    <Sheet title={shared?.name || '套装详情'} visible={!!shared} onClose={() => setShared(null)}>
      {shared && <><Text style={s.small}>{shared.author} · {new Date(shared.created_at).toLocaleString('zh-CN')}</Text><SetImages items={shared.items} /><Text style={s.small}>这是作者发布时的衣物快照，不会加入你的私人衣橱。</Text></>}
    </Sheet>
    {poll && <>
      <Section title="投票体验" en="POLL DEMO" />
      <View style={s.card}>
        <View style={s.pad}>
          <Text style={s.bold}>{poll.question}</Text>
          <Text style={s.small}>票数与占比为预置示例，仅保存我的选择，不计入公共票数。</Text>
        </View>
        {poll.options.map(option => {
          const voted = vote === option.id;
          const count = option.count;
          const pct = Math.round(count / (totalVotes || 1) * 100);
          return <Pressable
            key={option.id}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ selected: voted }}
            onPress={() => void mutate('/api/vote', json({ option: option.id }))}
            style={[{ flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: C.line, alignItems: 'flex-start' }, voted && { backgroundColor: '#FFF8F2', borderLeftWidth: 3, borderLeftColor: C.primary }]}
          >
            <View style={{ width: 68 }}><Photo uri={option.img} square /></View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={s.between}>
                <Text style={s.bold}>{option.label}</Text>
                {voted && <Text style={s.link}>已选择 ✓</Text>}
              </View>
              <Text style={s.small}>{voted ? '我的选择已保存' : '点击保存我的选择'}</Text>
              <View style={[s.meter, { marginVertical: 7 }]}><View style={{ width: `${pct}%`, height: 5, backgroundColor: voted ? C.primary : '#CDB8A6', borderRadius: 4 }} /></View>
              <Text style={s.small}>预置 {count} 票 · {pct}%</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </>}
    <Section title="穿搭笔记" en="NOTES" />
    <Text style={s.small}>编辑精选示例 · 昵称、图片、初始互动与评论用于内容演示，不代表真实用户实测或交易。</Text>
    <Chips values={['全部', '热门', '最新']} selected={sort} onSelect={setSort} />
    {posts.map(post => {
      const liked = state?.likes.includes(`post:${post.id}`);
      const comments = [...post.comments, ...(state?.comments[post.id] || [])];
      return <View key={post.id} style={s.card}>
        <View style={[s.row, s.pad, { paddingBottom: 8 }]}>
          <Image accessibilityLabel="作者头像" source={{ uri: asset(post.author.avatar) }} style={s.avatar} />
          <View><Text style={s.bold}>{post.author.name}</Text><Text style={s.small}>{post.bodyTag}</Text></View>
        </View>
        <Photo uri={post.cover} />
        <View style={s.pad}>
          <Pressable accessibilityRole="button" accessibilityLabel={`阅读笔记：${post.title}`} onPress={() => openNote(post)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={s.body}>{post.title}</Text></Pressable>
          {post.excerpt && <Text numberOfLines={2} style={[s.small, { marginTop: 6 }]}>{post.excerpt}</Text>}
          <Pressable accessibilityRole="button" onPress={() => openNote(post)} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}><Text style={s.link}>阅读笔记 →</Text></Pressable>
          <View style={[s.between, { marginTop: 8 }]}>
            <Pressable disabled={busy} onPress={() => void mutate(`/api/likes/post:${post.id}`)} style={s.row}>
              <Icon name="heart" color={liked ? C.primary : C.sub} /><Text style={s.small}>{post.likes + (liked ? 1 : 0)}</Text>
            </Pressable>
            <View style={s.row}>
              <Pressable accessibilityRole="button" onPress={() => openNote(post)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={s.link}>评论 {comments.length}</Text></Pressable>
              <Pressable onPress={() => void sharePost(post)}><Text style={s.link}>分享</Text></Pressable>
            </View>
          </View>
        </View>
      </View>;
    })}
    <Sheet title="穿搭笔记" visible={!!selected} onClose={() => setSelected(null)}>
      {selected && <>
        <Text style={[s.link, { marginTop: 12 }]}>编辑精选示例</Text>
        <Text style={[s.title, { marginTop: 8 }]}>{selected.title}</Text>
        <Text style={[s.small, { marginTop: 8 }]}>署名 {selected.author.name} · 图片与内容为搭配示意，非真人实测或交易记录。</Text>
        <View style={{ marginTop: 16, borderRadius: 12, overflow: 'hidden' }}><Photo uri={selected.cover} /></View>
        {selected.body?.map((paragraph, index) => <Text key={index} style={[s.body, { marginTop: 16 }]}>{paragraph}</Text>)}
        {!!selected.tips?.length && <View style={[s.info, { marginTop: 18, marginBottom: 0 }]}>
          <Text style={s.bold}>实用技巧</Text>
          {selected.tips.map((tip, index) => <Text key={tip} style={[s.body, { marginTop: 8 }]}>{index + 1}. {tip}</Text>)}
        </View>}
        {relatedOutfit && <View style={{ marginTop: 16 }}>
          <Text style={s.small}>关联搭配 · {relatedOutfit.title}</Text>
          <Button title="查看关联搭配" soft onPress={() => { setSelected(null); router.push({ pathname: '/set-detail', params: { id: relatedOutfit.id } }); }} />
        </View>}
        <Text style={[s.title, { marginTop: 24 }]}>评论 · {[...selected.comments, ...(state?.comments[selected.id] || [])].length} 条</Text>
        <Text style={[s.small, { marginTop: 6 }]}>标有「示例评论」的内容为预置演示；你提交的评论会保存到当前账户。</Text>
        {[...selected.comments, ...(state?.comments[selected.id] || [])].map((item, index) => <View key={`${item.user}-${index}`} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={s.bold}>{item.user}</Text><Text style={s.body}>{item.text}</Text></View>)}
        {!selected.comments.length && !(state?.comments[selected.id] || []).length && <Text style={s.empty}>还没有评论，来抢沙发</Text>}
        <TextInput placeholder="写下你的看法" value={comment} onChangeText={setComment} style={[s.input, { marginTop: 16 }]} />
        <Button title="发送评论" onPress={() => void sendComment()} disabled={!comment.trim() || busy} />
      </>}
    </Sheet>
  </Screen>;
}
