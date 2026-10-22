import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Checkbox, C, Field, Photo, Sheet, s } from './ui';
import { json, useStore, type SavedSet } from '../lib/store';

export function SetImages({ items }: { items: SavedSet['items'] }) {
  return <View style={[s.grid, { marginVertical: 10 }]}>{items.map(item => <View key={item.id} style={{ width: '30%' }}><Photo uri={item.image_url || undefined} square /><Text numberOfLines={2} style={s.small}>{item.name}</Text></View>)}</View>;
}
export default function SavedSets() {
  const { savedSets, wardrobe, mutate, busy, notify } = useStore();
  const [selected, setSelected] = useState<SavedSet | null>(null);
  const [editor, setEditor] = useState(false);
  const [name, setName] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'delete' | 'publish' | ''>('');
  const lock = useRef(false);
  const start = (value: SavedSet | null) => {
    setSelected(value); setName(value?.name || '');
    setIds(value?.items.filter(item => wardrobe.some(current => current.id === item.id)).map(item => item.id) || []); setEditor(true);
  };
  const run = async (path: string, options: RequestInit, message: string) => {
    if (lock.current || busy) return;
    lock.current = true;
    try { if (await mutate(path, options)) { setSelected(null); setEditor(false); setConfirm(''); notify(message); } }
    finally { lock.current = false; }
  };
  return <>
    <Button title="新建套装" soft disabled={busy} onPress={() => start(null)} />
    <Text style={[s.small, { marginVertical: 12 }]}>从自己的衣橱选两件以上，保存一套喜欢的搭配。</Text>
    {savedSets.map(value => <Pressable accessibilityRole="button" key={value.id} style={[s.card, s.pad]} onPress={() => { setSelected(value); setConfirm(''); }}><Text style={s.bold}>{value.name}</Text><SetImages items={value.items.slice(0, 3)} /><Text style={s.link}>{value.items.length} 件 · 查看详情{value.post_id ? ' · 已分享' : ''} →</Text></Pressable>)}
    {!savedSets.length && <Text style={s.empty}>还没有保存的套装。先添加衣物，再组合一套吧。</Text>}
    <Sheet title={selected ? '编辑套装' : '新建套装'} visible={editor} onClose={() => { if (!busy) { setEditor(false); setSelected(null); } }}>
      <Field label="套装名称（1–80字）" value={name} onChangeText={setName} />
      <Text style={[s.small, { marginVertical: 12 }]}>已选 {ids.length} 件 · 编辑时仅保留衣橱中仍存在的单品。保存不会修改已发布帖子。</Text>
      {!wardrobe.length && <Text style={s.empty}>请先在「我的单品」添加或导入衣物。</Text>}
      <View style={{ gap: 8 }}>{wardrobe.map(item => <View key={item.id} style={[s.row, { padding: 8, borderWidth: 1, borderColor: ids.includes(item.id) ? C.primary : C.line, borderRadius: 12 }]}><View style={{ width: 56, borderRadius: 8, overflow: 'hidden' }}><Photo uri={item.image_url || undefined} square /></View><View style={{ flex: 1 }}><Checkbox label={item.name} checked={ids.includes(item.id)} disabled={busy || (!ids.includes(item.id) && ids.length >= 30)} onChange={checked => setIds(current => checked ? current.length < 30 ? [...current, item.id] : current : current.filter(id => id !== item.id))} /></View></View>)}</View>
      <Button title="保存套装" disabled={busy || !name.trim() || name.trim().length > 80 || ids.length < 2} onPress={() => void run(selected ? `/api/outfit-sets/${selected.id}` : '/api/outfit-sets', json({ name: name.trim(), item_ids: ids }, selected ? 'PUT' : 'POST'), '套装已保存')} />
    </Sheet>
    <Sheet title={confirm === 'delete' ? '确认删除套装' : confirm === 'publish' ? '分享到社区' : selected?.name || '套装详情'} visible={!!selected && !editor} onClose={() => { if (!busy) { setSelected(null); setConfirm(''); } }}>
      {selected && <><SetImages items={selected.items} /><Text style={s.small}>保存于 {new Date(selected.created_at).toLocaleString('zh-CN')} · 衣物快照，删除单品不影响这套记录。</Text>
        {confirm ? <><Text style={[s.body, { marginTop: 12 }]}>{confirm === 'delete' ? '确认删除这套保存记录？已发布的社区帖子会保留。' : '发布后，社区用户可以看到套装名称、单品图片和你的昵称。每套仅发布一次，帖子保留此次快照。'}</Text><Button title={confirm === 'delete' ? '确认删除这一套' : '确认发布到社区'} disabled={busy} onPress={() => void run(`/api/outfit-sets/${selected.id}${confirm === 'publish' ? '/publish' : ''}`, { method: confirm === 'publish' ? 'POST' : 'DELETE' }, confirm === 'publish' ? '套装已发布，可在社区查看' : '套装已删除')} /><Button title="取消" soft disabled={busy} onPress={() => setConfirm('')} /></> : <><Button title="编辑套装" soft disabled={busy} onPress={() => start(selected)} /><Button title={selected.post_id ? '已分享到社区' : '分享到社区'} disabled={busy || !!selected.post_id} onPress={() => setConfirm('publish')} /><Button title="删除这套" soft disabled={busy} onPress={() => setConfirm('delete')} /></>}
      </>}
    </Sheet>
  </>;
}
