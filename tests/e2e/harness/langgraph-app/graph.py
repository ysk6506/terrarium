"""LangGraph agent for the Terrarium connector e2e.

Default: a scripted fake chat model picks the tool calls (no LLM needed).
With LG_MODEL_BASE_URL (+ LG_MODEL_NAME, LG_MODEL_API_KEY) set, a real OpenAI-compatible model is used instead
(pip install langchain-openai). Terrarium passes the run's MCP address in config.configurable.terrarium_mcp_url.
"""
import json, os, re, time
from typing import Any, List, Optional
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import create_react_agent

LOG = os.environ.get("LG_E2E_LOG", "")
def log(*a):
    if not LOG:
        return
    with open(LOG, "a") as f:
        f.write(" ".join(str(x) for x in a) + "\n")

class ScriptedModel(BaseChatModel):
    """Looks at tool results so far and picks the next scripted call."""
    @property
    def _llm_type(self) -> str: return "scripted"
    def bind_tools(self, tools, **kw): return self
    def _generate(self, messages: List[BaseMessage], stop=None, run_manager=None, **kw) -> ChatResult:
        results = [m for m in messages if isinstance(m, ToolMessage)]
        n = len(results)
        text = "\n".join(str(m.content) for m in results)
        def call(name, args):
            return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"call-{n}"}],
                             usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120})
        if n == 0: msg = call("list_alarms", {})
        elif n == 1: msg = call("facility_status", {})
        else:
            m = re.search(r"ca-[a-z0-9-]+", text)
            unit = m.group(0) if m else "unknown"
            if n == 2: msg = call("restart_cooling_unit", {"unitId": unit})
            elif n == 3: msg = call("submit_diagnosis", {"rootCause": unit, "faultType": "cooling_unit_failure",
                "summary": f"냉방기 {unit} 정지로 서버룸 온도가 올랐다. 재시작을 시도했다.",
                "actions": [{"tool": "restart_cooling_unit", "unitId": unit}], "confidence": 0.8})
            else: msg = AIMessage(content="done")
        log("model step", n, "->", [t["name"] for t in msg.tool_calls])
        return ChatResult(generations=[ChatGeneration(message=msg)])

async def agent_node(state: MessagesState, config: RunnableConfig):
    cfg = config.get("configurable", {})
    url = cfg.get("terrarium_mcp_url")
    log("configurable", json.dumps({k: v for k, v in cfg.items() if k.startswith("terrarium")}))
    client = MultiServerMCPClient({"terrarium": {"transport": "streamable_http", "url": url}})
    tools = await client.get_tools()
    log("tools", [t.name for t in tools])
    if os.environ.get("LG_MODEL_BASE_URL"):
        from langchain_openai import ChatOpenAI
        model = ChatOpenAI(base_url=os.environ["LG_MODEL_BASE_URL"], model=os.environ.get("LG_MODEL_NAME", "gpt-4o"),
                           api_key=os.environ.get("LG_MODEL_API_KEY", "none"))
    else:
        model = ScriptedModel()
    agent = create_react_agent(model, tools)
    out = await agent.ainvoke({"messages": state["messages"]}, {"recursion_limit": 30})
    for m in out["messages"]:
        if isinstance(m, ToolMessage): log("tool result", m.name, str(m.content)[:300].replace("\n", " "))
    return {"messages": out["messages"][len(state["messages"]):]}

builder = StateGraph(MessagesState)
builder.add_node("agent", agent_node)
builder.add_edge(START, "agent")
builder.add_edge("agent", END)
graph = builder.compile()
