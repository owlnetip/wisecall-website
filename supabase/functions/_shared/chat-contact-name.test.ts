import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractChatName } from "./chat-contact-name.ts";

Deno.test("real names are captured", () => {
  assertEquals(extractChatName("Hi my name is jane smith and I want to sell"), "Jane Smith");
  assertEquals(extractChatName("Hello, I'm Sarah Jones from Leeds"), "Sarah Jones");
  assertEquals(extractChatName("This is Mark, can you call me back?"), "Mark");
  assertEquals(extractChatName("I am Priya Patel"), "Priya Patel");
  assertEquals(extractChatName("my name's o'neill"), "O'Neill");
  assertEquals(extractChatName("Name is Tom. Email tom@x.com"), "Tom");
});

Deno.test("sentences are not names", () => {
  assertEquals(extractChatName("Hi, I am thinking of selling my 3 bed semi in Leeds"), undefined);
  assertEquals(extractChatName("I'm looking to sell quickly"), undefined);
  assertEquals(extractChatName("I am interested in a cash offer"), undefined);
  assertEquals(extractChatName("i'm moving abroad next month"), undefined);
  assertEquals(extractChatName("I am not sure what it's worth"), undefined);
  assertEquals(extractChatName("I'm selling a house"), undefined);
  assertEquals(extractChatName("Im wondering about fees"), undefined);
  assertEquals(extractChatName("It's a terraced house"), undefined);
  assertEquals(extractChatName("I am retired and downsizing"), undefined);
});

Deno.test("a later real name still wins after a sentence", () => {
  assertEquals(
    extractChatName("Hi, I am thinking of selling my house. My name is Testy McTestface, phone 07700 900461"),
    "Testy McTestface",
  );
  assertEquals(extractChatName("I'm hoping to sell. I'm Dave Brown"), "Dave Brown");
});

import { agentAskedForName, bareNameReply } from "./chat-contact-name.ts";

Deno.test("a bare reply to a name question is the name", () => {
  assertEquals(agentAskedForName("Thanks for letting me know. What's your name, please?"), true);
  assertEquals(agentAskedForName("What's your email address?"), false);
  assertEquals(bareNameReply("Sam Route"), "Sam Route");
  assertEquals(bareNameReply("jane"), "Jane");
  assertEquals(bareNameReply("Mary Ann Smith."), "Mary Ann Smith");
  assertEquals(bareNameReply("yes"), undefined);
  assertEquals(bareNameReply("selling"), undefined);
  assertEquals(bareNameReply("sam@example.com"), undefined);
  assertEquals(bareNameReply("07700 900491"), undefined);
  assertEquals(bareNameReply("I would rather not say"), undefined);
});
