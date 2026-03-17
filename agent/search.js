import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"

const base_url = "https://google.serper.dev/search"

const create_search_tool = (api_key, log = () => {}) =>
  new DynamicStructuredTool({
    name: "search",
    description: "搜索查找最新信息。传入搜索查询词，返回搜索结果摘要。",
    schema: z.object({
      query: z.string().describe("搜索查询词"),
    }),
    func: async ({ query }) => {
      log(query)

      const response = await fetch(base_url, {
          method: "POST",
          headers: {
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: query }),
        }),
        data = await response.json(),
        items = data.organic || []

      let text = "搜索结果：\n\n"

      const links = items
        .filter(c => c.link && c.title)
        .map((c, i) => {
          text += `${i + 1}. **${c.title}**\n   ${c.snippet}\n\n`
          return `[${i + 1}] [${c.title}](${c.link})`
        })

      if (links.length > 0) {
        text += "**资料来源:**\n" + links.join("\n")
      } else {
        text += "未能找到相关结果。"
      }
      return text
    },
  })

export default create_search_tool
