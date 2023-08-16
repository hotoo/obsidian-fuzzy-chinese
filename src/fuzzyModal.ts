import { SuggestModal, App, Component, MetadataCache, Vault } from "obsidian";
import Fuzyy_chinese from "./main";

export type MatchData<T> = {
    item: T;
    score: number;
    range: Array<[number, number]>;
};

export type Item = {
    name: string;
    pinyin: Pinyin<Item>;
};

export abstract class FuzzyModal<T extends Item> extends SuggestModal<MatchData<T>> {
    historyMatchData: HistoryMatchDataNode<T>;
    chooser: any;
    index: PinyinIndex<T>;
    plugin: Fuzyy_chinese;
    constructor(app: App, plugin: Fuzyy_chinese) {
        super(app);
        this.plugin = plugin;
        this.historyMatchData = new HistoryMatchDataNode("\0");
    }
    onOpen() {
        this.onInput(); // 无输入时触发历史记录
    }
    abstract getEmptyInputSuggestions(): MatchData<T>[];
    getSuggestions(query: string): MatchData<T>[] {
        if (query == "") {
            this.historyMatchData = new HistoryMatchDataNode("\0");
            return this.getEmptyInputSuggestions();
        }

        let matchData: MatchData<T>[] = [];
        let node = this.historyMatchData,
            lastNode: HistoryMatchDataNode<T>,
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
        let query_ = query.toLocaleLowerCase(),
            indexNode = this.historyMatchData.index(index - 1),
            toMatchData = indexNode.itemIndex.length == 0 ? this.index.items : indexNode.itemIndex;
        for (let p of toMatchData) {
            let d = p.pinyin.match(query_, p);
            if (d) matchData.push(d as MatchData<T>);
        }

        matchData = matchData.sort((a, b) => b.score - a.score);
        // 记录数据以便下次匹配可以使用
        if (!lastNode) lastNode = this.historyMatchData;
        lastNode.itemIndex = matchData.map((p) => p.item);
        return matchData;
    }

    renderSuggestion(matchData: MatchData<T>, el: HTMLElement) {
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
    onNoSuggestion(): void {
        this.chooser.addMessage(this.emptyStateText);
    }
    abstract onChooseSuggestion(matchData: MatchData<T>, evt: MouseEvent | KeyboardEvent): void;
    onClose() {
        this.inputEl.value = "";
        this.onInput();
        this.contentEl.empty();
    }
    getChoosenItem() {
        return this.chooser.values[this.chooser.selectedItem];
    }
}

export class HistoryMatchDataNode<T> {
    query: string[1];
    next: HistoryMatchDataNode<T>;
    itemIndex: Array<T>;
    itemIndexByPath: Array<T>;
    constructor(query: string[1]) {
        this.init(query);
    }
    push(query: string[1]) {
        let node = new HistoryMatchDataNode<T>(query);
        this.next = node;
        return node;
    }
    index(index: number) {
        let node: HistoryMatchDataNode<T> = this;
        for (let i = 0; i < index; i++) {
            if (node.next) node = node.next;
            else return;
        }
        return node;
    }
    init(query: string[1]) {
        this.query = query;
        this.next = null;
        this.itemIndex = [];
        this.itemIndexByPath = [];
    }
}

export class Pinyin<T extends Item> extends Array<PinyinChild> {
    query: string;
    constructor(query: string, plugin: Fuzyy_chinese) {
        super();
        let pinyinDict = plugin?.pinyinDict;
        this.query = query.toLowerCase();
        this.query.split("").forEach((p) => {
            let index = pinyinDict.values.map((q, i) => (q.includes(p) ? i : null)).filter((p) => p);
            this.push({
                type: index.length == 0 ? "other" : "pinyin",
                character: p,
                pinyin: index.length == 0 ? p : pinyinDict.keys.filter((_, i) => index.includes(i)),
            });
        });
    }
    getScore(range: Array<[number, number]>) {
        let score = 0;
        score += 40 / (this.query.length - range.reduce((p, i) => p + i[1] - i[0] + 1, 0)); //覆盖越广分越高
        if (range[0][0] == 0) score += 8; //顶头加分
        score += 20 / range.length; //分割越少分越高
        return score;
    }
    match(query: string, item: T): MatchData<T> | false {
        let range = this.match_(query);
        range = range ? toRanges(range) : false;
        if (!range) return false;
        let data: MatchData<T> = {
            item: item,
            score: this.getScore(range),
            range: range,
        };
        return data;
    }
    concat(pinyin: Pinyin<T>) {
        let result = new Pinyin<T>("", null);
        result.query = this.query + pinyin.query;
        for (let i of this) {
            result.push(i);
        }
        for (let i of pinyin) {
            result.push(i);
        }
        return result;
    }
    // The following two functions are based on the work of zh-lx (https://github.com/zh-lx).
    // Original code: https://github.com/zh-lx/pinyin-pro/blob/main/lib/core/match/index.ts.
    match_(pinyin: string) {
        pinyin = pinyin.replace(/\s/g, "");
        const result = this.matchAboveStart(this.query, pinyin);
        return result;
    }

    matchAboveStart(text: string, pinyin: string) {
        const words = text.split("");

        // 二维数组 dp[i][j]，i 表示遍历到的 text 索引+1, j 表示遍历到的 pinyin 的索引+1
        const dp = Array(words.length + 1);
        // 使用哨兵初始化 dp
        for (let i = 0; i < dp.length; i++) {
            dp[i] = Array(pinyin.length + 1);
            dp[i][0] = [];
        }
        for (let i = 0; i < dp[0].length; i++) {
            dp[0][i] = [];
        }

        // 动态规划匹配
        for (let i = 1; i < dp.length; i++) {
            // options.continuous 为 false 或 options.space 为 ignore 且当前为空格时，第 i 个字可以不参与匹配
            if (text[i - 1] === " ") {
                for (let j = 1; j <= pinyin.length; j++) {
                    dp[i][j - 1] = dp[i - 1][j - 1];
                }
            }
            // 第 i 个字参与匹配
            for (let j = 1; j <= pinyin.length; j++) {
                if (!dp[i - 1][j - 1]) {
                    // 第 i - 1 已经匹配失败，停止向后匹配
                    continue;
                } else if (j !== 1 && !dp[i - 1][j - 1].length) {
                    // 非开头且前面的字符未匹配完成，停止向后匹配
                    continue;
                } else {
                    const muls = this[i - 1].pinyin;
                    // 非中文匹配
                    if (text[i - 1] === pinyin[j - 1]) {
                        const matches = [...dp[i - 1][j - 1], i - 1];
                        // 记录最长的可匹配下标数组
                        if (!dp[i][j] || matches.length > dp[i][j].length) {
                            dp[i][j] = matches;
                        }
                        // pinyin 参数完全匹配完成，记录结果
                        if (j === pinyin.length) {
                            return dp[i][j];
                        }
                    }
                    if (typeof muls == "string") continue;
                    // 剩余长度小于等于 MAX_PINYIN_LENGTH(6) 时，有可能是最后一个拼音了
                    if (pinyin.length - j <= 6) {
                        // lastPrecision 参数处理
                        const last = muls.some((py) => {
                            return py.startsWith(pinyin.slice(j - 1, pinyin.length));
                        });
                        if (last) {
                            return [...dp[i - 1][j - 1], i - 1];
                        }
                    }

                    if (muls.some((py) => py[0] === pinyin[j - 1])) {
                        const matches = [...dp[i - 1][j - 1], i - 1];
                        // 记录最长的可匹配下标数组
                        if (!dp[i][j] || matches.length > dp[i][j].length) {
                            dp[i][j] = matches;
                        }
                    }

                    // 匹配当前汉字的完整拼音
                    const completeMatch = muls.find((py: string) => py === pinyin.slice(j - 1, j - 1 + py.length));
                    if (completeMatch) {
                        const matches = [...dp[i - 1][j - 1], i - 1];
                        const endIndex = j - 1 + completeMatch.length;
                        // 记录最长的可匹配下标数组
                        if (!dp[i][endIndex] || matches.length > dp[i][endIndex].length) {
                            dp[i][endIndex] = matches;
                        }
                    }
                }
            }
        }
        return null;
    }
}

type PinyinChild = {
    type: "pinyin" | "other";
    character: string[1];
    pinyin: string | string[];
};

// 将一个有序的数字数组转换为一个由连续数字区间组成的数组
// console.log(toRanges([1, 2, 3, 5, 7, 8]));
// 输出: [[1,3],[5,5],[7,8]]
function toRanges(arr: Array<number>): Array<[number, number]> {
    const result = [];
    let start = arr[0];
    let end = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] === end + 1) {
            end = arr[i];
        } else {
            result.push([start, end]);
            start = arr[i];
            end = arr[i];
        }
    }
    result.push([start, end]);
    return result;
}

export abstract class PinyinIndex<T> extends Component {
    vault: Vault;
    metadataCache: MetadataCache;
    items: Array<T>;
    plugin: Fuzyy_chinese;
    constructor(app: App, plugin: Fuzyy_chinese) {
        super();
        this.plugin = plugin;
        this.vault = app.vault;
        this.metadataCache = app.metadataCache;
        this.items = [];
        this.initEvent();
        if (app.workspace.layoutReady) {
            this.initIndex();
        } else {
            app.workspace.onLayoutReady(async () => {
                this.initIndex();
            });
        }
    }
    abstract initIndex(): void;
    abstract initEvent(): void;
    abstract update(...args: any[]): void;
}