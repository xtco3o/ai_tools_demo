#!/usr/bin/env bun

import { homedir } from "os"
import { join, basename } from "path"
import { readFileSync } from "fs"
import yaml from "js-yaml"

const keys = (await import(join(homedir(), ".config/gemini.js"))).default
process.env.GOOGLE_API_KEY = keys[Math.floor(Math.random() * keys.length)]

import { createDeepAgent } from "deepagents"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { DynamicStructuredTool } from "@langchain/core/tools"
import { bold, dim, cyan, green, yellow, magenta, blue } from "ansis"
import 创建搜索工具 from "./agent/search.js"

const 配置 = yaml.load(readFileSync(join(import.meta.dirname, "conf.yml"), "utf8"))
const MODEL = 配置.model

const 打印段 = (标记, 标题, 详情) =>
  console.log(`\n${bold(`${标记} ${标题}`)} ${dim(详情 || "")}`)

const 打印项 = (前缀, 文本) =>
  console.log(`  ${cyan(前缀)} ${文本}`)

const 内容转文本 = (内容) => {
  if (typeof 内容 === "string") return 内容
  if (Array.isArray(内容))
    return 内容
      .map(b => b.text || b.thinking || (typeof b === "string" ? b : ""))
      .filter(Boolean)
      .join("\n")
  if (typeof 内容 === "object" && 内容 !== null) return JSON.stringify(内容, null, 2)
  return String(内容)
}

const 搜索工具 = 创建搜索工具(配置.serper_key, (query) => 打印项(dim("[search]"), query))

const TODO图标 = { completed: "[x]", in_progress: "[~]" }

const CONF = {
  model: MODEL,
  temperature: 配置.temperature,
}
if (配置.thinkingConfig) {
  CONF.thinkingConfig = 配置.thinkingConfig
}

const 模型 = new ChatGoogleGenerativeAI(CONF)

const 智能体 = createDeepAgent({
    model: 模型,
    tools: [搜索工具],
    systemPrompt: 配置.system_prompt,
    subagents: [
      {
        name: "researcher",
        description: 配置.subagents?.researcher?.description,
        systemPrompt: 配置.subagents?.researcher?.prompt,
      },
    ],
  }),
  活跃子图 = new Map()

const 提取思考 = (消息) => {
  if (!Array.isArray(消息.content)) return
  for (const 块 of 消息.content) {
    if (块.type === "thinking" && 块.thinking) {
      打印段("??", "思考过程", "thinking")
      console.log(`  ${dim(块.thinking.slice(0, 600))}`)
    }
  }
}

const 模型请求 = (消息列表) => {
  let 文本 = ""
  for (const 消息 of 消息列表) {
    const 工具调用 = 消息.tool_calls || []

    提取思考(消息)

    for (const tc of 工具调用) {
      switch (tc.name) {
        case "write_todos":
          打印段(">>", "任务规划", "write_todos")
          for (const t of tc.args?.todos || [])
            打印项(TODO图标[t.status] || "[ ]", t.content || t.description || t.todo || JSON.stringify(t))
          break
        case "task":
          活跃子图.set(tc.id, {
            type: tc.args?.subagent_type,
            desc: (tc.args?.description || "").slice(0, 100),
            status: "pending",
          })
          打印段("->", "派生子 Agent", magenta(tc.args?.subagent_type || ""))
          打印项("  ", (tc.args?.description || "").slice(0, 150))
          break
        case "search":
          打印段("~~", "Google 搜索", cyan(tc.args?.query || ""))
          break
        default:
          console.log("未匹配的工具调用:", tc.name, tc.args)
          break
      }
    }
    if (!工具调用.length) {
      const t = 内容转文本(消息.content)
      if (t) 文本 = t
    }
  }
  return 文本
}

const 子图请求 = (消息列表) => {
  for (const 消息 of 消息列表) {
    提取思考(消息)
    for (const tc of 消息.tool_calls || []) {
      if (tc.name === "write_todos") {
        打印段("  >>", "子 Agent 任务规划", "")
        for (const t of tc.args?.todos || [])
          打印项("    [ ]", t.content || t.description || JSON.stringify(t))
      } else if (tc.name === "search") {
        打印段("  ~~", "子 Agent 搜索", cyan(tc.args?.query || ""))
      } else if (tc.name && tc.name !== "task") {
        打印项(`  ${dim(`[${tc.name}]`)}`, JSON.stringify(tc.args).slice(0, 120))
      }
    }
  }
}

const 工具完成 = (消息列表) => {
  for (const 消息 of 消息列表) {
    if (消息.type !== "tool") continue
    const 子图 = 活跃子图.get(消息.tool_call_id)
    if (子图) {
      子图.status = "complete"
      打印段("<-", "子 Agent 完成", green(子图.type))
      打印项("  ", 内容转文本(消息.content).slice(0, 300))
    } else if (消息.name === "search") {
      打印项(dim("[搜索结果]"), 内容转文本(消息.content).slice(0, 200))
    } else if (消息.name && 消息.name !== "task" && 消息.name !== "write_todos") {
      打印项(dim(`[${消息.name}]`), 内容转文本(消息.content).slice(0, 200))
    } else {
      console.log('?',消息)
    }
  }
}

const 标记运行 = () => {
  for (const [, 子图] of 活跃子图) {
    if (子图.status === "pending") {
      子图.status = "running"
      打印段("~~", "子 Agent 执行中", blue(子图.type))
      break
    }
  }
}

const run = async () => {
  const 问题 = 配置.question

  console.log(bold(`\n===== DeepAgents Demo : ${basename(import.meta.dirname)} =====`))
  打印段("Q:", "用户问题", "")
  console.log(`  ${yellow(问题)}`)

  const stream = await 智能体.stream(
    { messages: [{ role: "user", content: 问题 }] },
    { streamMode: "updates", subgraphs: true },
  )

  let 最终回答 = ""

  for await (const [ns, chunk] of stream) {
    for (const [节点, data] of Object.entries(chunk)) {
      const 是主图 = ns.length === 0,
        是子图 = ns.some(s => s.startsWith("tools:")),
        消息列表 = data?.messages || []

      if (是主图 && 节点 === "model_request") {
        const t = 模型请求(消息列表)
        if (t) 最终回答 = t
      }

      if (是子图 && ns[0]?.startsWith("tools:")) {
        标记运行()
        if (节点 === "model_request") 子图请求(消息列表)
      }

      if (是主图 && 节点 === "tools") 工具完成(消息列表)
    }
  }

  if (最终回答) {
    打印段("A:", "最终回答", "")
    console.log(`\n${green(最终回答)}`)
  }

  if (活跃子图.size > 0) {
    console.log(dim("  子 Agent 统计:"))
    for (const [, 子图] of 活跃子图)
      console.log(`  ${子图.status === "complete" ? "[x]" : "[~]"} ${子图.type}: ${bold(子图.status)} - ${dim(子图.desc)}`)
  } else {
    console.log(dim("  本次未使用子 Agent"))
  }
}

run()
