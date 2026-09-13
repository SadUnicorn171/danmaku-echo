import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..", "..");
const buildResult = await build({
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  root,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src", "core", "reply.ts"),
      fileName: () => "reply.js",
      formats: ["iife"],
      name: "DanmakuEchoReply"
    },
    minify: false,
    outDir: resolve(root, "build", "test-artifacts"),
    sourcemap: false,
    target: "chrome110",
    write: false
  }
});
const output = Array.isArray(buildResult) ? buildResult[0] : buildResult;
const source = output.output.find((entry) => entry.type === "chunk")?.code;
if (!source) throw new Error("Could not build reply helper test module");
const context = {};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "reply.js" });
const reply = context.DanmakuEchoReply;

test("extracts a sender from nested Douyin renderer payloads", () => {
  assert.equal(reply.extractSenderFromRecord({
    options: {
      payload: {
        data: {
          message: {
            user_info: { nick_name: "深层弹幕用户" }
          }
        }
      }
    }
  }), "深层弹幕用户");
  assert.equal(reply.extractSenderFromRecord([
    { payload: { sender: { display_name: "数组中的发送者" } } }
  ]), "数组中的发送者");
});

test("does not confuse generic renderer names with sender names", () => {
  assert.equal(reply.extractSenderFromRecord({
    name: "CanvasDanmakuRenderer",
    options: { data: { title: "直播弹幕" } }
  }), "");
  assert.equal(reply.extractSenderFromRecord({ sender: { name: "真实发送者" } }), "真实发送者");
});

test("uses stable Douyin user ids when a nickname is unavailable", () => {
  assert.equal(reply.extractSenderFromRecord({
    bizData: { payload: { user: { id_str: "731234567890" } } }
  }), "731234567890");
  assert.equal(reply.extractSenderFromRecord({ sender_id: 7312345 }), "7312345");
  assert.equal(reply.extractSenderFromRecord({ id: "renderer-track-id" }), "");
});

test("extracts senders from newer nested platform metadata shapes", () => {
  assert.equal(reply.extractSenderFromRecord({
    args: {
      roomMessage: {
        userData: {
          profile: {
            author_name: "新版结构用户"
          }
        }
      }
    }
  }), "新版结构用户");
  assert.equal(reply.extractSenderFromRecord({
    payload: {
      member: {
        user_nickname: "成员昵称"
      }
    }
  }), "成员昵称");
});
