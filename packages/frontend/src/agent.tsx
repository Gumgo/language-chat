import { chat, ChatApiResponse, ChatMessage, Model, Sender } from "api";

export class Agent {
  private readonly messages: ChatMessage[] = [];

  public addMessage(sender: Sender, content: string): void {
    this.messages.push({ sender, content });
  }

  public async getResponse(model: Model, temperature: number): Promise<ChatApiResponse> {
    const response = await chat({ model, messages: this.messages, temperature });
    this.messages.push({ sender: "Assistant", content: response.message });
    return response;
  }
}