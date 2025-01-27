import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { PinyinIndex as PI, HistoryMatchDataNode, Pinyin, MatchData, Item } from "./utils";
import FuzzyChinesePinyinPlugin from "./main";

export default class TagEditorSuggest extends EditorSuggest<MatchData<Item>> {
    plugin: FuzzyChinesePinyinPlugin;
    index: PinyinIndex;
    historyMatchData: HistoryMatchDataNode<Item>;
    isYaml: boolean;
    constructor(app: App, plugin: FuzzyChinesePinyinPlugin) {
        super(app);
        this.plugin = plugin;
        this.index = this.plugin.addChild(new PinyinIndex(app, this.plugin));
        this.historyMatchData = new HistoryMatchDataNode("\0");
    }
    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo {
        var lineIndex = cursor.line,
            lineContent = editor.getLine(lineIndex),
            sub = lineContent.substr(0, cursor.ch);
        if (
            sub.match(/(^|\s)#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/g) &&
            "#" !== lineContent.substr(cursor.ch, 1)
        ) {
            this.isYaml = false;
            var a = sub.lastIndexOf("#"),
                s = sub.substr(a + 1);
            return {
                start: {
                    line: lineIndex,
                    ch: a,
                },
                end: {
                    line: lineIndex,
                    ch: cursor.ch,
                },
                query: s,
            };
        }
        let frontmatterPosition = (app.metadataCache.getFileCache(file) as any)?.frontmatterPosition;
        if (
            sub.match(/tags?: /) &&
            frontmatterPosition &&
            lineIndex > frontmatterPosition.start.line &&
            lineIndex < frontmatterPosition.end.line
        ) {
            this.isYaml = true;
            let match = sub.match(/(\S+)$/)?.first() ?? "";
            if (this.index.items.map((p) => p.name).includes(match)) return null;
            return {
                end: cursor,
                start: {
                    ch: sub.lastIndexOf(match),
                    line: cursor.line,
                },
                query: match,
            };
        }
        return null;
    }
    getSuggestions(content: EditorSuggestContext): MatchData<Item>[] {
        this.index.update();
        let query = content.query;
        if (query == "") {
            this.historyMatchData = new HistoryMatchDataNode("\0");
            return this.index.items.map((p) => {
                return { item: p, score: 0, range: null };
            });
        }

        let matchData: MatchData<Item>[] = [];
        let node = this.historyMatchData,
            lastNode: HistoryMatchDataNode<Item>,
            index = 0,
            _f = true;
        for (let i of query) {
            if (node) {
                if (i != node.query) {
                    node.init(i);
                    _f = false;
                }
            } else {
                node = lastNode.push(i);
            }
            lastNode = node;
            node = node.next;
            if (_f) index++;
        }
        let smathCase = /[A-Z]/.test(query),
            indexNode = this.historyMatchData.index(index - 1),
            toMatchData = indexNode.itemIndex.length == 0 ? this.index.items : indexNode.itemIndex;
        for (let p of toMatchData) {
            let d = p.pinyin.match(query, p, smathCase);
            if (d) matchData.push(d as MatchData<Item>);
        }

        matchData = matchData.sort((a, b) => b.score - a.score);
        // 记录数据以便下次匹配可以使用
        if (!lastNode) lastNode = this.historyMatchData;
        lastNode.itemIndex = matchData.map((p) => p.item);
        return matchData;
    }
    renderSuggestion(matchData: MatchData<Item>, el: HTMLElement) {
        el.addClass("fz-item");
        let range = matchData.range,
            text = matchData.item.name,
            index = 0;
        if (range) {
            for (const r of range) {
                el.appendText(text.slice(index, r[0]));
                el.createSpan({ cls: "suggestion-highlight", text: text.slice(r[0], r[1] + 1) });
                index = r[1] + 1;
            }
        }
        el.appendText(text.slice(index));
    }
    selectSuggestion(matchData: MatchData<Item>): void {
        var context = this.context;
        if (context) {
            var editor = context.editor,
                start = context.start,
                end = context.end,
                text = this.isYaml ? matchData.item.name : "#" + matchData.item.name + " ";
            editor.transaction({
                changes: [
                    {
                        from: start,
                        to: end,
                        text,
                    },
                ],
            });
            editor.setCursor({ line: start.line, ch: start.ch + text.length });
        }
    }
}

class PinyinIndex extends PI<Item> {
    constructor(app: App, plugin: FuzzyChinesePinyinPlugin) {
        super(app, plugin);
        this.id = "tag";
    }
    initIndex() {
        let tags: string[] = Object.keys(app.metadataCache.getTags()).map((p) => p.slice(1));
        this.items = tags.map((tag) => {
            let item = {
                name: tag,
                pinyin: new Pinyin(tag, this.plugin),
            };
            return item;
        });
    }
    initEvent() {}
    update() {
        let tags: string[] = Object.keys(app.metadataCache.getTags()).map((p) => p.slice(1));
        let oldTags = this.items.map((item) => item.name);
        let newTags = tags;
        let addedTags = newTags.filter((tag) => !oldTags.includes(tag));
        let removedTags = oldTags.filter((tag) => !newTags.includes(tag));
        if (addedTags.length > 0) {
            this.items.push(
                ...addedTags.map((tag) => {
                    let item = {
                        name: tag,
                        pinyin: new Pinyin(tag, this.plugin),
                    };
                    return item;
                })
            );
        }
        if (removedTags.length > 0) {
            this.items = this.items.filter((item) => !removedTags.includes(item.name));
        }
    }
}
