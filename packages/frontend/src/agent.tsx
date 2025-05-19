import { chat, ChatApiResponse, ChatMessage, Model, Sender } from "api";
import { logInfo } from "utilities/logger";

export class Agent {
  private readonly logChatForDebugging: boolean;
  private readonly messages: ChatMessage[] = [];

  public constructor(logChatForDebugging?: "LogChatForDebugging") {
    this.logChatForDebugging = logChatForDebugging === "LogChatForDebugging";
  }

  public addMessage(sender: Sender, content: string): void {
    const message: ChatMessage = { sender, content };
    this.messages.push({ sender, content });
    if (this.logChatForDebugging) {
      logInfo(message);
    }
  }

  public async getResponse(model: Model, temperature: number): Promise<ChatApiResponse> {
    const response = await chat({ model, messages: this.messages, temperature });
    const message: ChatMessage = { sender: "Assistant", content: response.message };
    this.messages.push(message);
    if (this.logChatForDebugging) {
      logInfo(message);
    }

    return response;
  }
}