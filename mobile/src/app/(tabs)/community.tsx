import { useMemo, useState } from 'react';
import { Image, Pressable, Share, Text, TextInput, View } from 'react-native';
import { Button, C, Chips, Icon, Photo, Screen, Section, Sheet, s } from '../../components/ui';
import { asset, json, useStore, type Post } from '../../lib/store';

export default function Community() {
  const { catalog, state, mutate, busy, notify } = useStore();
  const [sort, setSort] = useState('全部');
  const [selected, setSelected] = useState<Post | null>(null);
  const [comment, setComment] = useState('');
  const posts = useMemo(() => {
    const list = [...(catalog?.posts || [])];
    if (sort === '热门') return list.sort((a, b) => b.likes - a.likes);
    if (sort === '最新') return list.reverse();
    return list;
  }, [catalog, sort]);
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
      <Text style={[s.small, { flex: 1 }]}>V1.0 社区开放浏览、评论与投票，发布笔记功能将在后续版本上线</Text>
    </View>
    {poll && <>
      <Section title="本周投票" en="WEEKLY POLL" />
      <View style={s.card}>
        <View style={s.pad}>
          <Text style={s.bold}>{poll.question}</Text>
          <Text style={s.small}>投票截止：{poll.endsIn}</Text>
        </View>
        {poll.options.map(option => {
          const voted = vote === option.id;
          const count = option.count + (voted ? 1 : 0);
          const pct = Math.round(count / (totalVotes + (vote ? 1 : 0) || 1) * 100);
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
              <Text style={s.small}>{option.sub}</Text>
              <View style={[s.meter, { marginVertical: 7 }]}><View style={{ width: `${pct}%`, height: 5, backgroundColor: voted ? C.primary : '#CDB8A6', borderRadius: 4 }} /></View>
              <Text style={s.small}>{count} 票 · {pct}%</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </>}
    <Section title="穿搭笔记" en="NOTES" />
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
          <Text style={s.body}>{post.title}</Text>
          <View style={[s.between, { marginTop: 14 }]}>
            <Pressable disabled={busy} onPress={() => void mutate(`/api/likes/post:${post.id}`)} style={s.row}>
              <Icon name="heart" color={liked ? C.primary : C.sub} /><Text style={s.small}>{post.likes + (liked ? 1 : 0)}</Text>
            </Pressable>
            <View style={s.row}>
              <Pressable onPress={() => setSelected(post)}><Text style={s.link}>评论 {comments.length}</Text></Pressable>
              <Pressable onPress={() => void sharePost(post)}><Text style={s.link}>分享</Text></Pressable>
            </View>
          </View>
        </View>
      </View>;
    })}
    <Sheet title={selected ? `评论 · ${[...selected.comments, ...(state?.comments[selected.id] || [])].length} 条` : '评论'} visible={!!selected} onClose={() => setSelected(null)}>
      {selected && <>
        {[...selected.comments, ...(state?.comments[selected.id] || [])].map((item, index) => <View key={`${item.user}-${index}`} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={s.bold}>{item.user}</Text><Text style={s.body}>{item.text}</Text></View>)}
        {!selected.comments.length && !(state?.comments[selected.id] || []).length && <Text style={s.empty}>还没有评论，来抢沙发</Text>}
        <TextInput placeholder="写下你的看法" value={comment} onChangeText={setComment} style={[s.input, { marginTop: 16 }]} />
        <Button title="发送评论" onPress={() => void sendComment()} disabled={!comment.trim() || busy} />
      </>}
    </Sheet>
  </Screen>;
}
