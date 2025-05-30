# Agents

URL: https://developers.cloudflare.com/workers-ai/agents/

import { LinkButton } from "~/components"

<div style={{ textAlign: 'center', marginBottom: '2rem' }}>
  <p>Build AI assistants that can perform complex tasks on behalf of your users using Cloudflare Workers AI and Agents.</p>
  <LinkButton href="/agents/">Go to Agents documentation</LinkButton>
</div>

---

# Changelog

URL: https://developers.cloudflare.com/workers-ai/changelog/

import { ProductReleaseNotes } from "~/components";

{/* <!-- Actual content lives in /src/content/release-notes/workers-ai.yaml. Update the file there for new entries to appear here. For more details, refer to https://developers.cloudflare.com/style-guide/documentation-content-strategy/content-types/changelog/#yaml-file --> */}

<ProductReleaseNotes />

---

# Cloudflare Workers AI

URL: https://developers.cloudflare.com/workers-ai/

import { CardGrid, Description, Feature, LinkTitleCard, Plan, RelatedProduct, Render, LinkButton, Flex } from "~/components"

<Description>

Run machine learning models, powered by serverless GPUs, on Cloudflare's global network.
</Description>

<Plan type="workers-all" />

Workers AI allows you to run AI models in a serverless way, without having to worry about scaling, maintaining, or paying for unused infrastructure. You can invoke models running on GPUs on Cloudflare's network from your own code 鈥� from [Workers](/workers/), [Pages](/pages/), or anywhere via [the Cloudflare API](/api/resources/ai/methods/run/).

Workers AI gives you access to:
- **50+ [open-source models](/workers-ai/models/)**, available as a part of our model catalog
- Serverless, **pay-for-what-you-use** [pricing model](/workers-ai/platform/pricing/)
- All as part of a **fully-featured developer platform**, including [AI Gateway](/ai-gateway/), [Vectorize](/vectorize/), [Workers](/workers/) and more...

<div>
  <LinkButton href="/workers-ai/get-started">Get started</LinkButton>
  <LinkButton target="_blank" variant="secondary" icon="external" href="https://youtu.be/cK_leoJsBWY?si=4u6BIy_uBOZf9Ve8">Watch a Workers AI demo</LinkButton>
</div>


<Render file="custom_requirements" />

<Render file="file_issues" />

***

## Features

<Feature header="Models" href="/workers-ai/models/" cta="Browse models">

Workers AI comes with a curated set of popular open-source models that enable you to do tasks such as image classification, text generation, object detection and more.


</Feature>

***

## Related products

<RelatedProduct header="AI Gateway" href="/ai-gateway/" product="ai-gateway">

Observe and control your AI applications with caching, rate limiting, request retries, model fallback, and more.


</RelatedProduct>

<RelatedProduct header="Vectorize" href="/vectorize/" product="vectorize">

Build full-stack AI applications with Vectorize, Cloudflare鈥檚 vector database. Adding Vectorize enables you to perform tasks such as semantic search, recommendations, anomaly detection or can be used to provide context and memory to an LLM.


</RelatedProduct>

<RelatedProduct header="Workers" href="/workers/" product="workers">

Build serverless applications and deploy instantly across the globe for exceptional performance, reliability, and scale.


</RelatedProduct>

<RelatedProduct header="Pages" href="/pages/" product="pages">

Create full-stack applications that are instantly deployed to the Cloudflare global network.


</RelatedProduct>

<RelatedProduct header="R2" href="/r2/" product="r2">

Store large amounts of unstructured data without the costly egress bandwidth fees associated with typical cloud storage services.


</RelatedProduct>

<RelatedProduct header="D1" href="/d1/" product="d1">

Create new serverless SQL databases to query from your Workers and Pages projects.


</RelatedProduct>

<RelatedProduct header="Durable Objects" href="/durable-objects/" product="durable-objects">

A globally distributed coordination API with strongly consistent storage.


</RelatedProduct>

<RelatedProduct header="KV" href="/kv/" product="kv">

Create a global, low-latency, key-value data storage.


</RelatedProduct>

***

## More resources

<CardGrid>

<LinkTitleCard title="Get started" href="/workers-ai/get-started/workers-wrangler/" icon="open-book">
Build and deploy your first Workers AI application.
</LinkTitleCard>

<LinkTitleCard title="Plans" href="/workers-ai/platform/pricing/" icon="seti:shell">
Learn about Free and Paid plans.
</LinkTitleCard>

<LinkTitleCard title="Limits" href="/workers-ai/platform/limits/" icon="document">
Learn about Workers AI limits.
</LinkTitleCard>

<LinkTitleCard title="Use cases" href="/use-cases/ai/" icon="document">
Learn how you can build and deploy ambitious AI applications to Cloudflare's global network.
</LinkTitleCard>

<LinkTitleCard title="Storage options" href="/workers/platform/storage-options/" icon="open-book">
Learn which storage option is best for your project.
</LinkTitleCard>

<LinkTitleCard title="Developer Discord" href="https://discord.cloudflare.com" icon="discord">
Connect with the Workers community on Discord to ask questions, share what you are building, and discuss the platform with other developers.
</LinkTitleCard>

<LinkTitleCard title="@CloudflareDev" href="https://x.com/cloudflaredev" icon="x.com">
Follow @CloudflareDev on Twitter to learn about product announcements, and what is new in Cloudflare Workers.
</LinkTitleCard>

</CardGrid>

---

# Vercel AI SDK

URL: https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/

import { PackageManagers } from "~/components";

Workers AI can be used with the [Vercel AI SDK](https://sdk.vercel.ai/) for JavaScript and TypeScript codebases.

## Setup

Install the [`workers-ai-provider` provider](https://sdk.vercel.ai/providers/community-providers/cloudflare-workers-ai):

<PackageManagers pkg="workers-ai-provider" />

Then, add an AI binding in your Workers project Wrangler file:

```toml
[ai]
binding = "AI"
```

## Models

The AI SDK can be configured to work with [any AI model](/workers-ai/models/).

```js
import { createWorkersAI } from "workers-ai-provider";

const workersai = createWorkersAI({ binding: env.AI });

// Choose any model: https://developers.cloudflare.com/workers-ai/models/
const model = workersai("@cf/meta/llama-3.1-8b-instruct", {});
```

## Generate Text

Once you have selected your model, you can generate text from a given prompt.

```js
import { createWorkersAI } from 'workers-ai-provider';
import { generateText } from 'ai';

type Env = {
  AI: Ai;
};

export default {
  async fetch(_: Request, env: Env) {
    const workersai = createWorkersAI({ binding: env.AI });
    const result = await generateText({
      model: workersai('@cf/meta/llama-2-7b-chat-int8'),
      prompt: 'Write a 50-word essay about hello world.',
    });

    return new Response(result.text);
  },
};
```

## Stream Text

For longer responses, consider streaming responses to provide as the generation completes.

```js
import { createWorkersAI } from 'workers-ai-provider';
import { streamText } from 'ai';

type Env = {
  AI: Ai;
};

export default {
  async fetch(_: Request, env: Env) {
    const workersai = createWorkersAI({ binding: env.AI });
    const result = streamText({
      model: workersai('@cf/meta/llama-2-7b-chat-int8'),
      prompt: 'Write a 50-word essay about hello world.',
    });

    return result.toTextStreamResponse({
      headers: {
        // add these headers to ensure that the
        // response is chunked and streamed
        'Content-Type': 'text/x-unknown',
        'content-encoding': 'identity',
        'transfer-encoding': 'chunked',
      },
    });
  },
};
```

## Generate Structured Objects

You can provide a Zod schema to generate a structured JSON response.

```js
import { createWorkersAI } from 'workers-ai-provider';
import { generateObject } from 'ai';
import { z } from 'zod';

type Env = {
  AI: Ai;
};

export default {
  async fetch(_: Request, env: Env) {
    const workersai = createWorkersAI({ binding: env.AI });
    const result = await generateObject({
      model: workersai('@cf/meta/llama-3.1-8b-instruct'),
      prompt: 'Generate a Lasagna recipe',
      schema: z.object({
        recipe: z.object({
          ingredients: z.array(z.string()),
          description: z.string(),
        }),
      }),
    });

    return Response.json(result.object);
  },
};
```

---

# Workers Bindings

URL: https://developers.cloudflare.com/workers-ai/configuration/bindings/

import { Type, MetaInfo, WranglerConfig } from "~/components";

## Workers

[Workers](/workers/) provides a serverless execution environment that allows you to create new applications or augment existing ones.

To use Workers AI with Workers, you must create a Workers AI [binding](/workers/runtime-apis/bindings/). Bindings allow your Workers to interact with resources, like Workers AI, on the Cloudflare Developer Platform. You create bindings on the Cloudflare dashboard or by updating your [Wrangler file](/workers/wrangler/configuration/).

To bind Workers AI to your Worker, add the following to the end of your Wrangler file:

<WranglerConfig>

```toml
[ai]
binding = "AI" # i.e. available in your Worker on env.AI
```

</WranglerConfig>

## Pages Functions

[Pages Functions](/pages/functions/) allow you to build full-stack applications with Cloudflare Pages by executing code on the Cloudflare network. Functions are Workers under the hood.

To configure a Workers AI binding in your Pages Function, you must use the Cloudflare dashboard. Refer to [Workers AI bindings](/pages/functions/bindings/#workers-ai) for instructions.

## Methods

### async env.AI.run()

`async env.AI.run()` runs a model. Takes a model as the first parameter, and an object as the second parameter.

```javascript
const answer = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    prompt: "What is the origin of the phrase 'Hello, World'"
});
```

**Parameters**



* `model` <Type text="string" /> <MetaInfo text="required" />

  * The model to run.

  **Supported options**

  * `stream` <Type text="boolean" /> <MetaInfo text="optional" />
    * Returns a stream of results as they are available.



```javascript
const answer = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    prompt: "What is the origin of the phrase 'Hello, World'",
    stream: true
});

return new Response(answer, {
    headers: { "content-type": "text/event-stream" }
});
```

---

# Hugging Face Chat UI

URL: https://developers.cloudflare.com/workers-ai/configuration/hugging-face-chat-ui/

Use Workers AI with [Chat UI](https://github.com/huggingface/chat-ui?tab=readme-ov-file#text-embedding-models), an open-source chat interface offered by Hugging Face.

## Prerequisites

You will need the following:

* A [Cloudflare account](https://dash.cloudflare.com)
* Your [Account ID](/fundamentals/account/find-account-and-zone-ids/)
* An [API token](/workers-ai/get-started/rest-api/#1-get-api-token-and-account-id) for Workers AI

## Setup

First, decide how to reference your Account ID and API token (either directly in your `.env.local` using the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` variables or in the endpoint configuration).

Then, follow the rest of the setup instructions in the [Chat UI GitHub repository](https://github.com/huggingface/chat-ui?tab=readme-ov-file#text-embedding-models).

When setting up your models, specify the `cloudflare` endpoint.

```json
{
  "name" : "nousresearch/hermes-2-pro-mistral-7b",
  "tokenizer": "nousresearch/hermes-2-pro-mistral-7b",
  "parameters": {
    "stop": ["<|im_end|>"]
  },
  "endpoints" : [
    {
      "type": "cloudflare",
      // optionally specify these if not included in .env.local
      "accountId": "your-account-id",
      "apiToken": "your-api-token"
      //
    }
  ]
}
```

## Supported models

This template works with any [text generation models](/workers-ai/models/) that begin with the `@hf` parameter.

---

# Configuration

URL: https://developers.cloudflare.com/workers-ai/configuration/

import { DirectoryListing } from "~/components";

<DirectoryListing />

---

# Features

URL: https://developers.cloudflare.com/workers-ai/features/

import { DirectoryListing } from "~/components";

<DirectoryListing />

---

# OpenAI compatible API endpoints

URL: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/

import { Render } from "~/components"

<Render file="openai-compatibility" /> <br/>

## Usage

### Workers AI

Normally, Workers AI requires you to specify the model name in the cURL endpoint or within the `env.AI.run` function.

With OpenAI compatible endpoints,you can leverage the [openai-node sdk](https://github.com/openai/openai-node) to make calls to Workers AI. This allows you to use Workers AI by simply changing the base URL and the model name.

```js title="OpenAI SDK Example"
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: env.CLOUDFLARE_API_KEY,
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`
 });

const chatCompletion = await openai.chat.completions.create({
  messages: [{ role: "user", content: "Make some robot noises" }],
  model: "@cf/meta/llama-3.1-8b-instruct",
 });

const embeddings = await openai.embeddings.create({
    model: "@cf/baai/bge-large-en-v1.5",
    input: "I love matcha"
  });

```

```bash title="cURL example"
curl --request POST \
  --url https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions \
  --header "Authorization: Bearer {api_token}" \
  --header "Content-Type: application/json" \
  --data '
    {
      "model": "@cf/meta/llama-3.1-8b-instruct",
      "messages": [
        {
          "role": "user",
          "content": "how to build a wooden spoon in 3 short steps? give as short as answer as possible"
        }
      ]
    }
'
```

### AI Gateway

These endpoints are also compatible with [AI Gateway](/ai-gateway/providers/workersai/#openai-compatible-endpoints).

---

# JSON Mode

URL: https://developers.cloudflare.com/workers-ai/features/json-mode/

import { Code } from "~/components";

export const jsonModeSchema = `{
  response_format: {
    title: "JSON Mode",
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["json_object", "json_schema"],
      },
      json_schema: {},
    }
  }
}`;

export const jsonModeRequestExample = `{
  "messages": [
    {
      "role": "system",
      "content": "Extract data about a country."
    },
    {
      "role": "user",
      "content": "Tell me about India."
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "capital": {
          "type": "string"
        },
        "languages": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "name",
        "capital",
        "languages"
      ]
    }
  }
}`;

export const jsonModeResponseExample = `{
  "response": {
    "name": "India",
    "capital": "New Delhi",
    "languages": [
      "Hindi",
      "English",
      "Bengali",
      "Telugu",
      "Marathi",
      "Tamil",
      "Gujarati",
      "Urdu",
      "Kannada",
      "Odia",
      "Malayalam",
      "Punjabi",
      "Sanskrit"
    ]
  }
}`;

When we want text-generation AI models to interact with databases, services, and external systems programmatically, typically when using tool calling or building AI agents, we must have structured response formats rather than natural language.

Workers AI supports JSON Mode, enabling applications to request a structured output response when interacting with AI models.

## Schema

JSON Mode is compatible with OpenAI鈥檚 implementation; to enable add the `response_format` property to the request object using the following convention:

<Code code={jsonModeSchema} lang="json" />

Where `json_schema` must be a valid [JSON Schema](https://json-schema.org/) declaration.

## JSON Mode example

When using JSON Format, pass the schema as in the example below as part of the request you send to the LLM.

<Code code={jsonModeRequestExample} lang="json" />

The LLM will follow the schema, and return a response such as below:

<Code code={jsonModeResponseExample} lang="json" />

As you can see, the model is complying with the JSON schema definition in the request and responding with a validated JSON object.

## Supported Models

This is the list of models that now support JSON Mode:

- [@cf/meta/llama-3.1-8b-instruct-fast](/workers-ai/models/llama-3.1-8b-instruct-fast/)
- [@cf/meta/llama-3.1-70b-instruct](/workers-ai/models/llama-3.1-70b-instruct/)
- [@cf/meta/llama-3.3-70b-instruct-fp8-fast](/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
- [@cf/meta/llama-3-8b-instruct](/workers-ai/models/llama-3-8b-instruct/)
- [@cf/meta/llama-3.1-8b-instruct](/workers-ai/models/llama-3.1-8b-instruct/)
- [@cf/meta/llama-3.2-11b-vision-instruct](/workers-ai/models/llama-3.2-11b-vision-instruct/)
- [@hf/nousresearch/hermes-2-pro-mistral-7b](/workers-ai/models/hermes-2-pro-mistral-7b/)
- [@hf/thebloke/deepseek-coder-6.7b-instruct-awq](/workers-ai/models/deepseek-coder-6.7b-instruct-awq/)
- [@cf/deepseek-ai/deepseek-r1-distill-qwen-32b](/workers-ai/models/deepseek-r1-distill-qwen-32b/)

We will continue extending this list to keep up with new, and requested models.

Note that Workers AI can't guarantee that the model responds according to the requested JSON Schema. Depending on the complexity of the task and adequacy of the JSON Schema, the model may not be able to satisfy the request in extreme situations. If that's the case, then an error `JSON Mode couldn't be met` is returned and must be handled.

JSON Mode currently doesn't support streaming.

---

# Markdown Conversion

URL: https://developers.cloudflare.com/workers-ai/features/markdown-conversion/

import { Code, Type, MetaInfo, Details, Render } from "~/components";

[Markdown](https://en.wikipedia.org/wiki/Markdown) is essential for text generation and large language models (LLMs) in training and inference because it can provide structured, semantic, human, and machine-readable input. Likewise, Markdown facilitates chunking and structuring input data for better retrieval and synthesis in the context of RAGs, and its simplicity and ease of parsing and rendering make it ideal for AI Agents.

For these reasons, document conversion plays an important role when designing and developing AI applications. Workers AI provides the `toMarkdown` utility method that developers can use from the [`env.AI`](/workers-ai/configuration/bindings/) binding or the REST APIs for quick, easy, and convenient conversion and summary of documents in multiple formats to Markdown language.

## Methods and definitions

### async env.AI.toMarkdown()

Takes a list of documents in different formats and converts them to Markdown.

#### Parameter

- <code>documents</code>: <Type text="array" />- An array of
  `toMarkdownDocument`s.

#### Return values

- <code>results</code>: <Type text="array" />- An array of
  `toMarkdownDocumentResult`s.

### `toMarkdownDocument` definition

- `name` <Type text="string" />

  - Name of the document to convert.

- `blob` <Type text="Blob" />

  - A new [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob/Blob) object with the document content.

### `toMarkdownDocumentResult` definition

- `name` <Type text="string" />

  - Name of the converted document. Matches the input name.

- `mimetype` <Type text="string" />

  - The detected [mime type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types) of the document.

- `tokens` <Type text="number" />

  - The estimated number of tokens of the converted document.

- `data` <Type text="string" />

  - The content of the converted document in Markdown format.

## Supported formats

This is the list of support formats. We are constantly adding new formats and updating this table.

<Render file="markdown-conversion-support" product="workers-ai" />

## Example

In this example, we fetch a PDF document and an image from R2 and feed them both to `env.AI.toMarkdown`. The result is a list of converted documents. Workers AI models are used automatically to detect and summarize the image.

```typescript
import { Env } from "./env";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		// https://pub-979cb28270cc461d94bc8a169d8f389d.r2.dev/somatosensory.pdf
		const pdf = await env.R2.get("somatosensory.pdf");

		// https://pub-979cb28270cc461d94bc8a169d8f389d.r2.dev/cat.jpeg
		const cat = await env.R2.get("cat.jpeg");

		return Response.json(
			await env.AI.toMarkdown([
				{
					name: "somatosensory.pdf",
					blob: new Blob([await pdf.arrayBuffer()], {
						type: "application/octet-stream",
					}),
				},
				{
					name: "cat.jpeg",
					blob: new Blob([await cat.arrayBuffer()], {
						type: "application/octet-stream",
					}),
				},
			]),
		);
	},
};
```

This is the result:

```json
[
	{
		"name": "somatosensory.pdf",
		"mimeType": "application/pdf",
		"format": "markdown",
		"tokens": 0,
		"data": "# somatosensory.pdf\n## Metadata\n- PDFFormatVersion=1.4\n- IsLinearized=false\n- IsAcroFormPresent=false\n- IsXFAPresent=false\n- IsCollectionPresent=false\n- IsSignaturesPresent=false\n- Producer=Prince 20150210 (www.princexml.com)\n- Title=Anatomy of the Somatosensory System\n\n## Contents\n### Page 1\nThis is a sample document to showcase..."
	},
	{
		"name": "cat.jpeg",
		"mimeType": "image/jpeg",
		"format": "markdown",
		"tokens": 0,
		"data": "The image is a close-up photograph of Grumpy Cat, a cat with a distinctive grumpy expression and piercing blue eyes. The cat has a brown face with a white stripe down its nose, and its ears are pointed upright. Its fur is light brown and darker around the face, with a pink nose and mouth. The cat's eyes are blue and slanted downward, giving it a perpetually grumpy appearance. The background is blurred, but it appears to be a dark brown color. Overall, the image is a humorous and iconic representation of the popular internet meme character, Grumpy Cat. The cat's facial expression and posture convey a sense of displeasure or annoyance, making it a relatable and entertaining image for many people."
	}
]
```

## REST API

In addition to the Workers AI [binding](/workers-ai/configuration/bindings/), you can use the [REST API](/workers-ai/get-started/rest-api/):

```bash
curl https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/tomarkdown \
  -H 'Authorization: Bearer {API_TOKEN}' \
	-F "files=@cat.jpeg" \
	-F "files=@somatosensory.pdf"
```

## Pricing

`toMarkdown` is free for most format conversions. In some cases, like image conversion, it can use Workers AI models for object detection and summarization, which may incur additional costs if it exceeds the Workers AI free allocation limits. See the [pricing page](/workers-ai/platform/pricing/) for more details.

---

# Prompting

URL: https://developers.cloudflare.com/workers-ai/features/prompting/

import { Code } from "~/components";

export const scopedExampleOne = `{
  messages: [
    { role: "system", content: "you are a very funny comedian and you like emojis" },
    { role: "user", content: "tell me a joke about cloudflare" },
  ],
};`;

export const scopedExampleTwo = `{
  messages: [
    { role: "system", content: "you are a professional computer science assistant" },
    { role: "user", content: "what is WASM?" },
    { role: "assistant", content: "WASM (WebAssembly) is a binary instruction format that is designed to be a platform-agnostic" },
    { role: "user", content: "does Python compile to WASM?" },
    { role: "assistant", content: "No, Python does not directly compile to WebAssembly" },
    { role: "user", content: "what about Rust?" },
  ],
};`;

export const unscopedExampleOne = `{
  prompt: "tell me a joke about cloudflare";
}`;

export const unscopedExampleTwo = `{
  prompt: "<s>[INST]comedian[/INST]</s>\n[INST]tell me a joke about cloudflare[/INST]",
  raw: true
};`;

Part of getting good results from text generation models is asking questions correctly. LLMs are usually trained with specific predefined templates, which should then be used with the model's tokenizer for better results when doing inference tasks.

There are two ways to prompt text generation models with Workers AI:

:::note[Important]
We recommend using unscoped prompts for inference with LoRA.
:::

### Scoped Prompts

This is the <strong>recommended</strong> method. With scoped prompts, Workers AI takes the burden of knowing and using different chat templates for different models and provides a unified interface to developers when building prompts and creating text generation tasks.

Scoped prompts are a list of messages. Each message defines two keys: the role and the content.

Typically, the role can be one of three options:

- <strong>system</strong> - System messages define the AI's personality. You can
  use them to set rules and how you expect the AI to behave.
- <strong>user</strong> - User messages are where you actually query the AI by
  providing a question or a conversation.
- <strong>assistant</strong> - Assistant messages hint to the AI about the
  desired output format. Not all models support this role.

OpenAI has a [good explanation](https://platform.openai.com/docs/guides/text-generation#messages-and-roles) of how they use these roles with their GPT models. Even though chat templates are flexible, other text generation models tend to follow the same conventions.

Here's an input example of a scoped prompt using system and user roles:

<Code code={scopedExampleOne} lang="js" />

Here's a better example of a chat session using multiple iterations between the user and the assistant.

<Code code={scopedExampleTwo} lang="js" />

Note that different LLMs are trained with different templates for different use cases. While Workers AI tries its best to abstract the specifics of each LLM template from the developer through a unified API, you should always refer to the model documentation for details (we provide links in the table above.) For example, instruct models like Codellama are fine-tuned to respond to a user-provided instruction, while chat models expect fragments of dialogs as input.

### Unscoped Prompts

You can use unscoped prompts to send a single question to the model without worrying about providing any context. Workers AI will automatically convert your `prompt` input to a reasonable default scoped prompt internally so that you get the best possible prediction.

<Code code={unscopedExampleOne} lang="js" />

You can also use unscoped prompts to construct the model chat template manually. In this case, you can use the raw parameter. Here's an input example of a [Mistral](https://docs.mistral.ai/models/#chat-template) chat template prompt:

<Code code={unscopedExampleTwo} lang="js" />

---

# Dashboard

URL: https://developers.cloudflare.com/workers-ai/get-started/dashboard/

import { Render } from "~/components"

Follow this guide to create a Workers AI application using the Cloudflare dashboard.

## Prerequisites

Sign up for a [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages) if you have not already.

## Setup

To create a Workers AI application:

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com) and select your account.
2. Go to **Compute (Workers)** and **Workers & Pages**.
3. Select **Create**.
4. Under **Start from a template**, select **LLM App**. After you select your template, an [AI binding](/workers-ai/configuration/bindings/) will be created for you in the dashboard.
5. Review the provided code and select **Deploy**.
6. Preview your Worker at its provided [`workers.dev`](/workers/configuration/routing/workers-dev/) subdomain.

## Development

<Render file="dash-creation-next-steps" product="workers" />

---

# Getting started

URL: https://developers.cloudflare.com/workers-ai/get-started/

import { DirectoryListing } from "~/components"

There are several options to build your Workers AI projects on Cloudflare. To get started, choose your preferred method:

<DirectoryListing />

:::note


These examples are geared towards creating new Workers AI projects. For help adding Workers AI to an existing Worker, refer to [Workers Bindings](/workers-ai/configuration/bindings/).


:::

---

# REST API

URL: https://developers.cloudflare.com/workers-ai/get-started/rest-api/

This guide will instruct you through setting up and deploying your first Workers AI project. You will use the Workers AI REST API to experiment with a large language model (LLM).

## Prerequisites

Sign up for a [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages) if you have not already.

## 1. Get API token and Account ID

You need your API token and Account ID to use the REST API.

To get these values:

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com) and select your account.
2. Go to **AI** > **Workers AI**.
3. Select **Use REST API**.
4. Get your API token:
   1. Select **Create a Workers AI API Token**.
   2. Review the prefilled information.
   3. Select **Create API Token**.
   4. Select **Copy API Token**.
   5. Save that value for future use.
5. For **Get Account ID**, copy the value for **Account ID**. Save that value for future use.

:::note

If you choose to [create an API token](/fundamentals/api/get-started/create-token/) instead of using the template, that token will need permissions for both `Workers AI - Read` and `Workers AI - Edit`.

:::

## 2. Run a model via API

After creating your API token, authenticate and make requests to the API using your API token in the request.

You will use the [Execute AI model](/api/resources/ai/methods/run/) endpoint to run the [`@cf/meta/llama-3.1-8b-instruct`](/workers-ai/models/llama-3.1-8b-instruct/) model:

```bash
curl https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct \
  -H 'Authorization: Bearer {API_TOKEN}' \
  -d '{ "prompt": "Where did the phrase Hello World come from" }'
```

Replace the values for `{ACCOUNT_ID}` and `{API_token}`.

The API response will look like the following:

```json
{
	"result": {
		"response": "Hello, World first appeared in 1974 at Bell Labs when Brian Kernighan included it in the C programming language example. It became widely used as a basic test program due to simplicity and clarity. It represents an inviting greeting from a program to the world."
	},
	"success": true,
	"errors": [],
	"messages": []
}
```

This example execution uses the `@cf/meta/llama-3.1-8b-instruct` model, but you can use any of the models in the [Workers AI models catalog](/workers-ai/models/). If using another model, you will need to replace `{model}` with your desired model name.

By completing this guide, you have created a Cloudflare account (if you did not have one already) and an API token that grants Workers AI read permissions to your account. You executed the [`@cf/meta/llama-3.1-8b-instruct`](/workers-ai/models/llama-3.1-8b-instruct/) model using a cURL command from the terminal and received an answer to your prompt in a JSON response.

## Related resources

- [Models](/workers-ai/models/) - Browse the Workers AI models catalog.
- [AI SDK](/workers-ai/configuration/ai-sdk) - Learn how to integrate with an AI model.

---

# Workers Bindings

URL: https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/

import { Render, PackageManagers, WranglerConfig, TypeScriptExample } from "~/components";

This guide will instruct you through setting up and deploying your first Workers AI project. You will use [Workers](/workers/), a Workers AI binding, and a large language model (LLM) to deploy your first AI-powered application on the Cloudflare global network.

<Render file="prereqs" product="workers" />

## 1. Create a Worker project

You will create a new Worker project using the `create-cloudflare` CLI (C3). [C3](https://github.com/cloudflare/workers-sdk/tree/main/packages/create-cloudflare) is a command-line tool designed to help you set up and deploy new applications to Cloudflare.

Create a new project named `hello-ai` by running:

<PackageManagers type="create" pkg="cloudflare@latest" args={"hello-ai"} />

Running `npm create cloudflare@latest` will prompt you to install the [`create-cloudflare` package](https://www.npmjs.com/package/create-cloudflare), and lead you through setup. C3 will also install [Wrangler](/workers/wrangler/), the Cloudflare Developer Platform CLI.

<Render
	file="c3-post-run-steps"
	product="workers"
	params={{
		category: "hello-world",
		type: "Worker only",
		lang: "TypeScript",
	}}
/>

This will create a new `hello-ai` directory. Your new `hello-ai` directory will include:

- A `"Hello World"` [Worker](/workers/get-started/guide/#3-write-code) at `src/index.ts`.
- A [`wrangler.jsonc`](/workers/wrangler/configuration/) configuration file.

Go to your application directory:

```sh
cd hello-ai
```

## 2. Connect your Worker to Workers AI

You must create an AI binding for your Worker to connect to Workers AI. [Bindings](/workers/runtime-apis/bindings/) allow your Workers to interact with resources, like Workers AI, on the Cloudflare Developer Platform.

To bind Workers AI to your Worker, add the following to the end of your Wrangler file:

<WranglerConfig>

```toml
[ai]
binding = "AI"
```

</WranglerConfig>

Your binding is [available in your Worker code](/workers/reference/migrate-to-module-workers/#bindings-in-es-modules-format) on [`env.AI`](/workers/runtime-apis/handlers/fetch/).

{/* <!-- TODO update this once we know if we'll have it --> */}

You can also bind Workers AI to a Pages Function. For more information, refer to [Functions Bindings](/pages/functions/bindings/#workers-ai).

## 3. Run an inference task in your Worker

You are now ready to run an inference task in your Worker. In this case, you will use an LLM, [`llama-3.1-8b-instruct`](/workers-ai/models/llama-3.1-8b-instruct/), to answer a question.

Update the `index.ts` file in your `hello-ai` application directory with the following code:

<TypeScriptExample filename="index.ts">

```ts
export interface Env {
	// If you set another name in the Wrangler config file as the value for 'binding',
	// replace "AI" with the variable name you defined.
	AI: Ai;
}

export default {
	async fetch(request, env): Promise<Response> {
		const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
			prompt: "What is the origin of the phrase Hello, World",
		});

		return new Response(JSON.stringify(response));
	},
} satisfies ExportedHandler<Env>;
```
</TypeScriptExample>

Up to this point, you have created an AI binding for your Worker and configured your Worker to be able to execute the Llama 3.1 model. You can now test your project locally before you deploy globally.

## 4. Develop locally with Wrangler

While in your project directory, test Workers AI locally by running [`wrangler dev`](/workers/wrangler/commands/#dev):

```sh
npx wrangler dev
```

<Render file="ai-local-usage-charges" product="workers" />

You will be prompted to log in after you run the `wrangler dev`. When you run `npx wrangler dev`, Wrangler will give you a URL (most likely `localhost:8787`) to review your Worker. After you go to the URL Wrangler provides, a message will render that resembles the following example:

```json
{
	"response": "Ah, a most excellent question, my dear human friend! *adjusts glasses*\n\nThe origin of the phrase \"Hello, World\" is a fascinating tale that spans several decades and multiple disciplines. It all began in the early days of computer programming, when a young man named Brian Kernighan was tasked with writing a simple program to demonstrate the basics of a new programming language called C.\nKernighan, a renowned computer scientist and author, was working at Bell Labs in the late 1970s when he created the program. He wanted to showcase the language's simplicity and versatility, so he wrote a basic \"Hello, World!\" program that printed the familiar greeting to the console.\nThe program was included in Kernighan and Ritchie's influential book \"The C Programming Language,\" published in 1978. The book became a standard reference for C programmers, and the \"Hello, World!\" program became a sort of \"Hello, World!\" for the programming community.\nOver time, the phrase \"Hello, World!\" became a shorthand for any simple program that demonstrated the basics"
}
```

## 5. Deploy your AI Worker

Before deploying your AI Worker globally, log in with your Cloudflare account by running:

```sh
npx wrangler login
```

You will be directed to a web page asking you to log in to the Cloudflare dashboard. After you have logged in, you will be asked if Wrangler can make changes to your Cloudflare account. Scroll down and select **Allow** to continue.

Finally, deploy your Worker to make your project accessible on the Internet. To deploy your Worker, run:

```sh
npx wrangler deploy
```

```sh output
https://hello-ai.<YOUR_SUBDOMAIN>.workers.dev
```

Your Worker will be deployed to your custom [`workers.dev`](/workers/configuration/routing/workers-dev/) subdomain. You can now visit the URL to run your AI Worker.

By finishing this tutorial, you have created a Worker, connected it to Workers AI through an AI binding, and ran an inference task from the Llama 3 model.

## Related resources

- [Cloudflare Developers community on Discord](https://discord.cloudflare.com) - Submit feature requests, report bugs, and share your feedback directly with the Cloudflare team by joining the Cloudflare Discord server.
- [Models](/workers-ai/models/) - Browse the Workers AI models catalog.
- [AI SDK](/workers-ai/configuration/ai-sdk) - Learn how to integrate with an AI model.

---

# Guides

URL: https://developers.cloudflare.com/workers-ai/guides/

import { DirectoryListing } from "~/components";

<DirectoryListing />

---

# Demos and architectures

URL: https://developers.cloudflare.com/workers-ai/guides/demos-architectures/

import {
	ExternalResources,
	GlossaryTooltip,
	ResourcesBySelector,
} from "~/components";

Workers AI can be used to build dynamic and performant services. The following demo applications and reference architectures showcase how to use Workers AI optimally within your architecture.

## Demos

Explore the following <GlossaryTooltip term="demo application">demo applications</GlossaryTooltip> for Workers AI.

<ExternalResources type="apps" products={["Workers AI"]} />

## Reference architectures

Explore the following <GlossaryTooltip term="reference architecture">reference architectures</GlossaryTooltip> that use Workers AI:

<ResourcesBySelector
	types={[
		"reference-architecture",
		"design-guide",
		"reference-architecture-diagram",
	]}
	products={["Workers AI"]}
/>

---

# Models

URL: https://developers.cloudflare.com/workers-ai/models/

import ModelCatalog from "~/pages/workers-ai/models/index.astro";

<ModelCatalog />

---

# Data usage

URL: https://developers.cloudflare.com/workers-ai/platform/data-usage/

Cloudflare processes certain customer data in order to provide the Workers AI service, subject to our [Privacy Policy](https://www.cloudflare.com/privacypolicy/) and [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) or [Enterprise Subscription Agreement](https://www.cloudflare.com/enterpriseterms/) (as applicable).

Cloudflare neither creates nor trains the AI models made available on Workers AI. The models constitute Third-Party Services and may be subject to open source or other license terms that apply between you and the model provider. Be sure to review the license terms applicable to each model (if any).

Your inputs (e.g., text prompts, image submissions, audio files, etc.), outputs (e.g., generated text/images, translations, etc.), embeddings, and training data constitute Customer Content.

For Workers AI:

* You own, and are responsible for, all of your Customer Content.
* Cloudflare does not make your Customer Content available to any other Cloudflare customer.
* Cloudflare does not use your Customer Content to (1) train any AI models made available on Workers AI or (2) improve any Cloudflare or third-party services, and would not do so unless we received your explicit consent.
* Your Customer Content for Workers AI may be stored by Cloudflare if you specifically use a storage service (e.g., R2, KV, DO, Vectorize, etc.) in conjunction with Workers AI.

---

# Glossary

URL: https://developers.cloudflare.com/workers-ai/platform/glossary/

import { Glossary } from "~/components";

Review the definitions for terms used across Cloudflare's Workers AI documentation.

<Glossary product="workers-ai" />

---

# Errors

URL: https://developers.cloudflare.com/workers-ai/platform/errors/

Below is a list of Workers AI errors.

| **Name**                              | **Internal Code** | **HTTP Code** | **Description**                                                                                                                                      |
| ------------------------------------- | ----------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| No such model                         | `5007`            | `400`         | No such model `${model}` or task                                                                                                                     |
| Invalid data                          | `5004`            | `400`         | Invalid data type for base64 input: `${type}`                                                                                                        |
| Finetune missing required files       | `3039`            | `400`         | Finetune is missing required files `(model.safetensors and config.json) `                                                                            |
| Incomplete request                    | `3003`            | `400`         | Request is missing headers or body: `{what}`                                                                                                         |
| Account not allowed for private model | `5018`            | `403`         | The account is not allowed to access this model                                                                                                      |
| Model agreement                       | `5016`            | `403`         | User has not agreed to Llama3.2 model terms                                                                                                          |
| Account blocked                       | `3023`            | `403`         | Service unavailable for account                                                                                                                      |
| Account not allowed for private model | `3041`            | `403`         | The account is not allowed to access this model                                                                                                      |
| Deprecated SDK version                | `5019`            | `405`         | Request trying to use deprecated SDK version                                                                                                         |
| LoRa unsupported                      | `5005`            | `405`         | The model `${this.model}` does not support LoRa inference                                                                                            |
| Invalid model ID                      | `3042`            | `404`         | The model name is invalid                                                                                                                            |
| Request too large                     | `3006`            | `413`         | Request is too large                                                                                                                                 |
| Timeout                               | `3007`            | `408`         | Request timeout                                                                                                                                      |
| Aborted                               | `3008`            | `408`         | Request was aborted                                                                                                                                  |
| Account limited                       | `3036`            | `429`         | You have used up your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage. |
| Out of capacity                       | `3040`            | `429`         | No more data centers to forward the request to                                                                                                       |

---

# Platform

URL: https://developers.cloudflare.com/workers-ai/platform/

import { DirectoryListing } from "~/components";

<DirectoryListing />

---

# Limits

URL: https://developers.cloudflare.com/workers-ai/platform/limits/

import { Render } from "~/components"

Workers AI is now Generally Available. We've updated our rate limits to reflect this.

Note that model inferences in local mode using Wrangler will also count towards these limits. Beta models may have lower rate limits while we work on performance and scale.

<Render file="custom_requirements" />

Rate limits are default per task type, with some per-model limits defined as follows:

## Rate limits by task type

### [Automatic Speech Recognition](/workers-ai/models/)

* 720 requests per minute

### [Image Classification](/workers-ai/models/)

* 3000 requests per minute

### [Image-to-Text](/workers-ai/models/)

* 720 requests per minute

### [Object Detection](/workers-ai/models/)

* 3000 requests per minute

### [Summarization](/workers-ai/models/)

* 1500 requests per minute

### [Text Classification](/workers-ai/models/)

* 2000 requests per minute

### [Text Embeddings](/workers-ai/models/)

* 3000 requests per minute
* [@cf/baai/bge-large-en-v1.5](/workers-ai/models/bge-large-en-v1.5/) is 1500 requests per minute

### [Text Generation](/workers-ai/models/)

* 300 requests per minute
* [@hf/thebloke/mistral-7b-instruct-v0.1-awq](/workers-ai/models/mistral-7b-instruct-v0.1-awq/) is 400 requests per minute
* [@cf/microsoft/phi-2](/workers-ai/models/phi-2/) is 720 requests per minute
* [@cf/qwen/qwen1.5-0.5b-chat](/workers-ai/models/qwen1.5-0.5b-chat/) is 1500 requests per minute
* [@cf/qwen/qwen1.5-1.8b-chat](/workers-ai/models/qwen1.5-1.8b-chat/) is 720 requests per minute
* [@cf/qwen/qwen1.5-14b-chat-awq](/workers-ai/models/qwen1.5-14b-chat-awq/) is 150 requests per minute
* [@cf/tinyllama/tinyllama-1.1b-chat-v1.0](/workers-ai/models/tinyllama-1.1b-chat-v1.0/) is 720 requests per minute

### [Text-to-Image](/workers-ai/models/)

* 720 requests per minute
* [@cf/runwayml/stable-diffusion-v1-5-img2img](/workers-ai/models/stable-diffusion-v1-5-img2img/) is 1500 requests per minute

### [Translation](/workers-ai/models/)

* 720 requests per minute

---

# Pricing

URL: https://developers.cloudflare.com/workers-ai/platform/pricing/

:::note
Workers AI has updated pricing to be more granular, with per-model unit-based pricing presented, but still billing in neurons in the back end.
:::

Workers AI is included in both the [Free and Paid Workers plans](/workers/platform/pricing/) and is priced at **$0.011 per 1,000 Neurons**.

Our free allocation allows anyone to use a total of **10,000 Neurons per day at no charge**. To use more than 10,000 Neurons per day, you need to sign up for the [Workers Paid plan](/workers/platform/pricing/#workers). On Workers Paid, you will be charged at $0.011 / 1,000 Neurons for any usage above the free allocation of 10,000 Neurons per day.

You can monitor your Neuron usage in the [Cloudflare Workers AI dashboard](https://dash.cloudflare.com/?to=/:account/ai/workers-ai).

All limits reset daily at 00:00 UTC. If you exceed any one of the above limits, further operations will fail with an error.

|              | Free <br/> allocation  | Pricing                       |
| ------------ | ---------------------- | ----------------------------- |
| Workers Free | 10,000 Neurons per day | N/A - Upgrade to Workers Paid |
| Workers Paid | 10,000 Neurons per day | $0.011 / 1,000 Neurons        |

## What are Neurons?

Neurons are our way of measuring AI outputs across different models, representing the GPU compute needed to perform your request. Our serverless model allows you to pay only for what you use without having to worry about renting, managing, or scaling GPUs.

:::note
The Price in Tokens column is equivalent to the Price in Neurons column - the different units are displayed so you can easily compare and understand pricing.
:::

## LLM model pricing

| Model                                        | Price in Tokens                                            | Price in Neurons                                                          |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| @cf/meta/llama-3.2-1b-instruct               | $0.027 per M input tokens <br/> $0.201 per M output tokens | 2457 neurons per M input tokens <br/> 18252 neurons per M output tokens   |
| @cf/meta/llama-3.2-3b-instruct               | $0.051 per M input tokens <br/> $0.335 per M output tokens | 4625 neurons per M input tokens <br/> 30475 neurons per M output tokens   |
| @cf/meta/llama-3.1-8b-instruct-fp8-fast      | $0.045 per M input tokens <br/> $0.384 per M output tokens | 4119 neurons per M input tokens <br/> 34868 neurons per M output tokens   |
| @cf/meta/llama-3.2-11b-vision-instruct       | $0.049 per M input tokens <br/> $0.676 per M output tokens | 4410 neurons per M input tokens <br/> 61493 neurons per M output tokens   |
| @cf/meta/llama-3.1-70b-instruct-fp8-fast     | $0.293 per M input tokens <br/> $2.253 per M output tokens | 26668 neurons per M input tokens <br/> 204805 neurons per M output tokens |
| @cf/meta/llama-3.3-70b-instruct-fp8-fast     | $0.293 per M input tokens <br/> $2.253 per M output tokens | 26668 neurons per M input tokens <br/> 204805 neurons per M output tokens |
| @cf/deepseek-ai/deepseek-r1-distill-qwen-32b | $0.497 per M input tokens <br/> $4.881 per M output tokens | 45170 neurons per M input tokens <br/> 443756 neurons per M output tokens |
| @cf/mistral/mistral-7b-instruct-v0.1         | $0.110 per M input tokens <br/> $0.190 per M output tokens | 10000 neurons per M input tokens <br/> 17300 neurons per M output tokens  |
| @cf/mistralai/mistral-small-3.1-24b-instruct | $0.351 per M input tokens <br/> $0.555 per M output tokens | 31876 neurons per M input tokens <br/> 50488 neurons per M output tokens  |
| @cf/meta/llama-3.1-8b-instruct               | $0.282 per M input tokens <br/> $0.827 per M output tokens | 25608 neurons per M input tokens <br/> 75147 neurons per M output tokens  |
| @cf/meta/llama-3.1-8b-instruct-fp8           | $0.152 per M input tokens <br/> $0.287 per M output tokens | 13778 neurons per M input tokens <br/> 26128 neurons per M output tokens  |
| @cf/meta/llama-3.1-8b-instruct-awq           | $0.123 per M input tokens <br/> $0.266 per M output tokens | 11161 neurons per M input tokens <br/> 24215 neurons per M output tokens  |
| @cf/meta/llama-3-8b-instruct                 | $0.282 per M input tokens <br/> $0.827 per M output tokens | 25608 neurons per M input tokens <br/> 75147 neurons per M output tokens  |
| @cf/meta/llama-3-8b-instruct-awq             | $0.123 per M input tokens <br/> $0.266 per M output tokens | 11161 neurons per M input tokens <br/> 24215 neurons per M output tokens  |
| @cf/meta/llama-2-7b-chat-fp16                | $0.556 per M input tokens <br/> $6.667 per M output tokens | 50505 neurons per M input tokens <br/> 606061 neurons per M output tokens |
| @cf/meta/llama-guard-3-8b                    | $0.484 per M input tokens <br/> $0.030 per M output tokens | 44003 neurons per M input tokens <br/> 2730 neurons per M output tokens   |
| @cf/meta/llama-4-scout-17b-16e-instruct      | $0.270 per M input tokens <br/> $0.850 per M output tokens | 24545 neurons per M input tokens <br/> 77273 neurons per M output tokens  |
| @cf/google/gemma-3-12b-it                    | $0.345 per M input tokens <br/> $0.556 per M output tokens | 31371 neurons per M input tokens <br/> 50560 neurons per M output tokens  |
| @cf/qwen/qwq-32b                             | $0.660 per M input tokens <br/> $1.000 per M output tokens | 60000 neurons per M input tokens <br/> 90909 neurons per M output tokens  |
| @cf/qwen/qwen2.5-coder-32b-instruct          | $0.660 per M input tokens <br/> $1.000 per M output tokens | 60000 neurons per M input tokens <br/> 90909 neurons per M output tokens  |

## Embeddings model pricing

| Model                      | Price in Tokens           | Price in Neurons                 |
| -------------------------- | ------------------------- | -------------------------------- |
| @cf/baai/bge-small-en-v1.5 | $0.020 per M input tokens | 1841 neurons per M input tokens  |
| @cf/baai/bge-base-en-v1.5  | $0.067 per M input tokens | 6058 neurons per M input tokens  |
| @cf/baai/bge-large-en-v1.5 | $0.204 per M input tokens | 18582 neurons per M input tokens |
| @cf/baai/bge-m3            | $0.012 per M input tokens | 1075 neurons per M input tokens  |

## Other model pricing

| Model                                 | Price in Tokens                                            | Price in Neurons                                                         |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| @cf/black-forest-labs/flux-1-schnell  | $0.0000528 per 512x512 tile <br/> $0.0001056 per step      | 4.80 neurons per 512x512 tile <br/> 9.60 neurons per step                |
| @cf/huggingface/distilbert-sst-2-int8 | $0.026 per M input tokens                                  | 2394 neurons per M input tokens                                          |
| @cf/baai/bge-reranker-base            | $0.003 per M input tokens                                  | 283 neurons per M input tokens                                           |
| @cf/meta/m2m100-1.2b                  | $0.342 per M input tokens <br/> $0.342 per M output tokens | 31050 neurons per M input tokens <br/> 31050 neurons per M output tokens |
| @cf/microsoft/resnet-50               | $2.51 per M images                                         | 228055 neurons per M images                                              |
| @cf/openai/whisper                    | $0.0005 per audio minute                                   | 41.14 neurons per audio minute                                           |
| @cf/openai/whisper-large-v3-turbo     | $0.0005 per audio minute                                   | 46.63 neurons per audio minute                                           |
| @cf/myshell-ai/melotts                | $0.0002 per audio minute                                   | 18.63 neurons per audio minute                                           |

---

# Asynchronous Batch API

URL: https://developers.cloudflare.com/workers-ai/features/batch-api/

import { Render, PackageManagers, WranglerConfig, CURL } from "~/components";

Asynchronous batch processing lets you send a collection (batch) of inference requests in a single call. Instead of expecting immediate responses for every request, the system queues them for processing and returns the results later.

Batch processing is useful for large workloads such as summarization or embeddings when there is no human interaction. Using the batch API will guarantee that your requests are fulfilled eventually, rather than erroring out if Cloudflare does have enough capacity at a given time.

When you send a batch request, the API immediately acknowledges receipt with a status like `queued` and provides a unique `request_id`. This ID is later used to poll for the final responses once the processing is complete.

You can use the Batch API by either creating and deploying a Cloudflare Worker that leverages the [Batch API with the AI binding](/workers-ai/features/batch-api/workers-binding/), using the [REST API](/workers-ai/features/batch-api/rest-api/) directly or by starting from a [template](https://github.com/craigsdennis/batch-please-workers-ai).

:::note[Note]

Ensure that the total payload is under 10 MB.

:::

## Demo application

If you want to get started quickly, click the button below:

[![Deploy to Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/craigsdennis/batch-please-workers-ai)

This will create a repository in your GitHub account and deploy a ready-to-use Worker that demonstrates how to use Cloudflare's Asynchronous Batch API. The template includes preconfigured AI bindings, and examples for sending and retrieving batch requests with and without external references. Once deployed, you can visit the live Worker and start experimenting with the Batch API immediately.

## Supported Models

- [@cf/meta/llama-3.3-70b-instruct-fp8-fast](/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
- [@cf/baai/bge-small-en-v1.5](/workers-ai/models/bge-small-en-v1.5/)
- [@cf/baai/bge-base-en-v1.5](/workers-ai/models/bge-base-en-v1.5/)
- [@cf/baai/bge-large-en-v1.5](/workers-ai/models/bge-large-en-v1.5/)
- [@cf/baai/bge-m3](/workers-ai/models/bge-m3/)
- [@cf/meta/m2m100-1.2b](/workers-ai/models/m2m100-1.2b/)

---

# REST API

URL: https://developers.cloudflare.com/workers-ai/features/batch-api/rest-api/

If you prefer to work directly with the REST API instead of a [Cloudflare Worker](/workers-ai/features/batch-api/workers-binding/), below are the steps on how to do it:

## 1. Sending a Batch Request

Make a POST request using the following pattern. You can pass `external_reference` as a unique ID per-prompt that will be returned in the response.

```bash title="Sending a batch request" {11,15,19}
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/baai/bge-m3?queueRequest=true" \
 --header "Authorization: Bearer $API_TOKEN" \
 --header 'Content-Type: application/json' \
 --json '{
    "requests": [
        {
            "query": "This is a story about Cloudflare",
            "contexts": [
                {
                    "text": "This is a story about an orange cloud",
                    "external_reference": "story1"
                },
                {
                    "text": "This is a story about a llama",
                    "external_reference": "story2"
                },
                {
                    "text": "This is a story about a hugging emoji",
                    "external_reference": "story3"
                }
            ]
        }
    ]
  }'
```

```json output {4}
{
	"result": {
		"status": "queued",
		"request_id": "768f15b7-4fd6-4498-906e-ad94ffc7f8d2",
		"model": "@cf/baai/bge-m3"
	},
	"success": true,
	"errors": [],
	"messages": []
}
```

## 2. Retrieving the Batch Response

After receiving a `request_id` from your initial POST, you can poll for or retrieve the results with another POST request:

```bash title="Retrieving a response"
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/baai/bge-m3?queueRequest=true" \
 --header "Authorization: Bearer $API_TOKEN" \
 --header 'Content-Type: application/json' \
 --json '{
    "request_id": "<uuid>"
  }'
```

```json output
{
	"result": {
		"responses": [
			{
				"id": 0,
				"result": {
					"response": [
						{ "id": 0, "score": 0.73974609375 },
						{ "id": 1, "score": 0.642578125 },
						{ "id": 2, "score": 0.6220703125 }
					]
				},
				"success": true,
				"external_reference": null
			}
		],
		"usage": { "prompt_tokens": 12, "completion_tokens": 0, "total_tokens": 12 }
	},
	"success": true,
	"errors": [],
	"messages": []
}
```

---

# Workers Binding

URL: https://developers.cloudflare.com/workers-ai/features/batch-api/workers-binding/

import {
	Render,
	PackageManagers,
	TypeScriptExample,
	WranglerConfig,
	CURL,
} from "~/components";

You can use Workers Bindings to interact with the Batch API.

## Send a Batch request

Send your initial batch inference request by composing a JSON payload containing an array of individual inference requests and the `queueRequest: true` property (which is what controlls queueing behavior).

:::note[Note]

Ensure that the total payload is under 10 MB.

:::

```ts {26} title="src/index.ts"
export interface Env {
	AI: Ai;
}
export default {
	async fetch(request, env): Promise<Response> {
		const embeddings = await env.AI.run(
			"@cf/baai/bge-m3",
			{
				requests: [
					{
						query: "This is a story about Cloudflare",
						contexts: [
							{
								text: "This is a story about an orange cloud",
							},
							{
								text: "This is a story about a llama",
							},
							{
								text: "This is a story about a hugging emoji",
							},
						],
					},
				],
			},
			{ queueRequest: true },
		);

		return Response.json(embeddings);
	},
} satisfies ExportedHandler<Env>;
```

```json output {4}
{
	"status": "queued",
	"model": "@cf/baai/bge-m3",
	"request_id": "000-000-000"
}
```

You will get a response with the following values:

- **`status`**: Indicates that your request is queued.
- **`request_id`**: A unique identifier for the batch request.
- **`model`**: The model used for the batch inference.

Of these, the `request_id` is important for when you need to [poll the batch status](#poll-batch-status).

### Poll batch status

Once your batch request is queued, use the `request_id` to poll for its status. During processing, the API returns a status `queued` or `running` indicating that the request is still in the queue or being processed.

```typescript title=src/index.ts
export interface Env {
	AI: Ai;
}

export default {
	async fetch(request, env): Promise<Response> {
		const status = await env.AI.run("@cf/baai/bge-m3", {
			request_id: "000-000-000",
		});

		return Response.json(status);
	},
} satisfies ExportedHandler<Env>;
```

```json output
{
	"responses": [
		{
			"id": 0,
			"result": {
				"response": [
					{ "id": 0, "score": 0.73974609375 },
					{ "id": 1, "score": 0.642578125 },
					{ "id": 2, "score": 0.6220703125 }
				]
			},
			"success": true,
			"external_reference": null
		}
	],
	"usage": { "prompt_tokens": 12, "completion_tokens": 0, "total_tokens": 12 }
}
```

When the inference is complete, the API returns a final HTTP status code of `200` along with an array of responses. Each response object corresponds to an individual input prompt, identified by an `id` that maps to the index of the prompt in your original request.

---

# Fine-tunes

URL: https://developers.cloudflare.com/workers-ai/features/fine-tunes/

import { Feature } from "~/components";

Learn how to use Workers AI to get fine-tuned inference.

<Feature header="Fine-tuned inference with LoRAs" href="/workers-ai/features/fine-tunes/loras/" cta="Run inference with LoRAs">

Upload a LoRA adapter and run fine-tuned inference with one of our base models.

</Feature>

---

## What is fine-tuning?

Fine-tuning is a general term for modifying an AI model by continuing to train it with additional data. The goal of fine-tuning is to increase the probability that a generation is similar to your dataset. Training a model from scratch is not practical for many use cases given how expensive and time consuming they can be to train. By fine-tuning an existing pre-trained model, you benefit from its capabilities while also accomplishing your desired task.

[Low-Rank Adaptation](https://arxiv.org/abs/2106.09685) (LoRA) is a specific fine-tuning method that can be applied to various model architectures, not just LLMs. It is common that the pre-trained model weights are directly modified or fused with additional fine-tune weights in traditional fine-tuning methods. LoRA, on the other hand, allows for the fine-tune weights and pre-trained model to remain separate, and for the pre-trained model to remain unchanged. The end result is that you can train models to be more accurate at specific tasks, such as generating code, having a specific personality, or generating images in a specific style.

---

# Using LoRA adapters

URL: https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/

import { TabItem, Tabs } from "~/components";

Workers AI supports fine-tuned inference with adapters trained with [Low-Rank Adaptation](https://blog.cloudflare.com/fine-tuned-inference-with-loras). This feature is in open beta and free during this period.

## Limitations

- We only support LoRAs for the following models (must not be quantized):

  - `@cf/meta/llama-3.2-11b-vision-instruct`
  - `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
  - `@cf/meta/llama-guard-3-8b`
  - `@cf/meta/llama-3.1-8b-instruct-fast (soon)`
  - `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`
  - `@cf/qwen/qwen2.5-coder-32b-instruct`
  - `@cf/qwen/qwq-32b`
  - `@cf/mistralai/mistral-small-3.1-24b-instruct`
  - `@cf/google/gemma-3-12b-it`

- Adapter must be trained with rank `r <=8` as well as larger ranks if up to 32. You can check the rank of a pre-trained LoRA adapter through the adapter's `config.json` file
- LoRA adapter file must be < 300MB
- LoRA adapter files must be named `adapter_config.json` and `adapter_model.safetensors` exactly
- You can test up to 30 LoRA adapters per account

---

## Choosing compatible LoRA adapters

### Finding open-source LoRA adapters

We have started a [Hugging Face Collection](https://huggingface.co/collections/Cloudflare/workers-ai-compatible-loras-6608dd9f8d305a46e355746e) that lists a few LoRA adapters that are compatible with Workers AI. Generally, any LoRA adapter that fits our limitations above should work.

### Training your own LoRA adapters

To train your own LoRA adapter, follow the [tutorial](/workers-ai/guides/tutorials/fine-tune-models-with-autotrain/).

---

## Uploading LoRA adapters

In order to run inference with LoRAs on Workers AI, you'll need to create a new fine tune on your account and upload your adapter files. You should have a `adapter_model.safetensors` file with model weights and `adapter_config.json` with your config information. _Note that we only accept adapter files in these types._

Right now, you can't edit a fine tune's asset files after you upload it. We will support this soon, but for now you will need to create a new fine tune and upload files again if you would like to use a new LoRA.

Before you upload your LoRA adapter, you'll need to edit your `adapter_config.json` file to include `model_type` as one of `mistral`, `gemma` or `llama` like below.

```json null {10}
{
  "alpha_pattern": {},
  "auto_mapping": null,
  ...
  "target_modules": [
    "q_proj",
    "v_proj"
  ],
  "task_type": "CAUSAL_LM",
  "model_type": "mistral",
}
```

### Wrangler

You can create a finetune and upload your LoRA adapter via wrangler with the following commands:

```bash title="wrangler CLI" {1,7}
npx wrangler ai finetune create <model_name> <finetune_name> <folder_path>
#馃寑 Creating new finetune "test-lora" for model "@cf/mistral/mistral-7b-instruct-v0.2-lora"...
#馃寑 Uploading file "/Users/abcd/Downloads/adapter_config.json" to "test-lora"...
#馃寑 Uploading file "/Users/abcd/Downloads/adapter_model.safetensors" to "test-lora"...
#鉁� Assets uploaded, finetune "test-lora" is ready to use.

npx wrangler ai finetune list
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹�
鈹� finetune_id                          鈹� name            鈹� description 鈹�
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹�
鈹� 00000000-0000-0000-0000-000000000000 鈹� test-lora       鈹�             鈹�
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹粹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹粹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹�
```

### REST API

Alternatively, you can use our REST API to create a finetune and upload your adapter files. You will need a Cloudflare API Token with `Workers AI: Edit` permissions to make calls to our REST API, which you can generate via the Cloudflare Dashboard.

#### Creating a fine-tune on your account

```bash title="cURL"
## Input: user-defined name of fine tune
## Output: unique finetune_id

curl -X POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/finetunes/ \
    -H "Authorization: Bearer {API_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{
      "model": "SUPPORTED_MODEL_NAME",
      "name": "FINETUNE_NAME",
      "description": "OPTIONAL_DESCRIPTION"
    }'
```

#### Uploading your adapter weights and config

You have to call the upload endpoint each time you want to upload a new file, so you usually run this once for `adapter_model.safetensors` and once for `adapter_config.json`. Make sure you include the `@` before your path to files.

You can either use the finetune `name` or `id` that you used when you created the fine tune.

```bash title="cURL"
## Input: finetune_id, adapter_model.safetensors, then adapter_config.json
## Output: success true/false

curl -X POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/finetunes/{FINETUNE_ID}/finetune-assets/ \
    -H 'Authorization: Bearer {API_TOKEN}' \
    -H 'Content-Type: multipart/form-data' \
    -F 'file_name=adapter_model.safetensors' \
    -F 'file=@{PATH/TO/adapter_model.safetensors}'
```

#### List fine-tunes in your account

You can call this method to confirm what fine-tunes you have created in your account

<Tabs> <TabItem label="curl">

```bash title="cURL"
## Input: n/a
## Output: success true/false

curl -X GET https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/finetunes/ \
    -H 'Authorization: Bearer {API_TOKEN}'
```

</TabItem> <TabItem label="json output">

```json title="Example JSON output"
# Example output JSON
{
  "success": true,
  "result": [
    [{
       "id": "00000000-0000-0000-0000-000000000",
       "model": "@cf/meta-llama/llama-2-7b-chat-hf-lora",
       "name": "llama2-finetune",
       "description": "test"
    },
    {
       "id": "00000000-0000-0000-0000-000000000",
       "model": "@cf/mistralai/mistral-7b-instruct-v0.2-lora",
       "name": "mistral-finetune",
       "description": "test"
    }]
  ]
}
```

</TabItem> </Tabs>

---

## Running inference with LoRAs

To make inference requests and apply the LoRA adapter, you will need your model and finetune `name` or `id`. You should use the chat template that your LoRA was trained on, but you can try running it with `raw: true` and the messages template like below.

<Tabs> <TabItem label="workers ai sdk">

```javascript null {5-6}
const response = await env.AI.run(
	"@cf/mistralai/mistral-7b-instruct-v0.2-lora", //the model supporting LoRAs
	{
		messages: [{ role: "user", content: "Hello world" }],
		raw: true, //skip applying the default chat template
		lora: "00000000-0000-0000-0000-000000000", //the finetune id OR name
	},
);
```

</TabItem> <TabItem label="rest api">

```bash null {5-6}
curl https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/mistral/mistral-7b-instruct-v0.2-lora \
  -H 'Authorization: Bearer {API_TOKEN}' \
  -d '{
    "messages": [{"role": "user", "content": "Hello world"}],
    "raw": "true",
    "lora": "00000000-0000-0000-0000-000000000"
  }'
```

</TabItem> </Tabs>

---

# Public LoRA adapters

URL: https://developers.cloudflare.com/workers-ai/features/fine-tunes/public-loras/

Cloudflare offers a few public LoRA adapters that can immediately be used for fine-tuned inference. You can try them out immediately via our [playground](https://playground.ai.cloudflare.com).

Public LoRAs will have the name `cf-public-x`, and the prefix will be reserved for Cloudflare.

:::note


Have more LoRAs you would like to see? Let us know on [Discord](https://discord.cloudflare.com).


:::

| Name                                                                       | Description                        | Compatible with                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| [cf-public-magicoder](https://huggingface.co/predibase/magicoder)          | Coding tasks in multiple languages | `@cf/mistral/mistral-7b-instruct-v0.1` <br/> `@hf/mistral/mistral-7b-instruct-v0.2` |
| [cf-public-jigsaw-classification](https://huggingface.co/predibase/jigsaw) | Toxic comment classification       | `@cf/mistral/mistral-7b-instruct-v0.1` <br/> `@hf/mistral/mistral-7b-instruct-v0.2` |
| [cf-public-cnn-summarization](https://huggingface.co/predibase/cnn)        | Article summarization              | `@cf/mistral/mistral-7b-instruct-v0.1` <br/> `@hf/mistral/mistral-7b-instruct-v0.2` |

You can also list these public LoRAs with an API call:

```bash
curl https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/finetunes/public \
 --header 'Authorization: Bearer {cf_token}'
```

## Running inference with public LoRAs

To run inference with public LoRAs, you just need to define the LoRA name in the request.

We recommend that you use the prompt template that the LoRA was trained on. You can find this in the HuggingFace repos linked above for each adapter.

### cURL

```bash null {10}
curl https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/mistral/mistral-7b-instruct-v0.1 \
  --header 'Authorization: Bearer {cf_token}' \
  --data '{
    "messages": [
      {
        "role": "user",
        "content": "Write a python program to check if a number is even or odd."
      }
    ],
    "lora": "cf-public-magicoder"
  }'
```

### JavaScript

```js null {11}
const answer = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.1',
  {
    stream: true,
    raw: true,
    messages: [
      {
        "role": "user",
        "content": "Summarize the following: Some newspapers, TV channels and well-known companies publish false news stories to fool people on 1 April. One of the earliest examples of this was in 1957 when a programme on the BBC, the UKs national TV channel, broadcast a report on how spaghetti grew on trees. The film showed a family in Switzerland collecting spaghetti from trees and many people were fooled into believing it, as in the 1950s British people didnt eat much pasta and many didnt know how it was made! Most British people wouldnt fall for the spaghetti trick today, but in 2008 the BBC managed to fool their audience again with their Miracles of Evolution trailer, which appeared to show some special penguins that had regained the ability to fly. Two major UK newspapers, The Daily Telegraph and the Daily Mirror, published the important story on their front pages."
      }
    ],
    lora: "cf-public-cnn-summarization"
  });
```

---

# Function calling

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/

import { Stream, TabItem, Tabs } from "~/components";

Function calling enables people to take Large Language Models (LLMs) and use the model response to execute functions or interact with external APIs. The developer usually defines a set of functions and the required input schema for each function, which we call `tools`. The model then intelligently understands when it needs to do a tool call, and it returns a JSON output which the user needs to feed to another function or API.

In essence, function calling allows you to perform actions with LLMs by executing code or making additional API calls.

<Stream id="603e94c9803b4779dd612493c0dd7125" title="placeholder" />

## How can I use function calling?

Workers AI has [embedded function calling](/workers-ai/features/function-calling/embedded/) which allows you to execute function code alongside your inference calls. We have a package called [`@cloudflare/ai-utils`](https://www.npmjs.com/package/@cloudflare/ai-utils) to help facilitate this, which we have open-sourced on [Github](https://github.com/cloudflare/ai-utils).

For industry-standard function calling, take a look at the documentation on [Traditional Function Calling](/workers-ai/features/function-calling/traditional/).

To show you the value of embedded function calling, take a look at the example below that compares traditional function calling with embedded function calling. Embedded function calling allowed us to cut down the lines of code from 77 to 31.

<Tabs> <TabItem label="Embedded">

```sh
# The ai-utils package enables embedded function calling
npm i @cloudflare/ai-utils
```

```js title="Embedded function calling example"
import {
	createToolsFromOpenAPISpec,
	runWithTools,
	autoTrimTools,
} from "@cloudflare/ai-utils";

export default {
	async fetch(request, env, ctx) {
		const response = await runWithTools(
			env.AI,
			"@hf/nousresearch/hermes-2-pro-mistral-7b",
			{
				messages: [{ role: "user", content: "Who is Cloudflare on github?" }],
				tools: [
					// You can pass the OpenAPI spec link or contents directly
					...(await createToolsFromOpenAPISpec(
						"https://gist.githubusercontent.com/mchenco/fd8f20c8f06d50af40b94b0671273dc1/raw/f9d4b5cd5944cc32d6b34cad0406d96fd3acaca6/partial_api.github.com.json",
						{
							overrides: [
								{
									// for all requests on *.github.com, we'll need to add a User-Agent.
									matcher: ({ url, method }) => {
										return url.hostname === "api.github.com";
									},
									values: {
										headers: {
											"User-Agent":
												"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
										},
									},
								},
							],
						},
					)),
				],
			},
		).then((response) => {
			return response;
		});

		return new Response(JSON.stringify(response));
	},
};
```

</TabItem> <TabItem label="Traditional">

```js title="Traditional function calling example"
export default {
	async fetch(request, env, ctx) {
		const response = await env.AI.run(
			"@hf/nousresearch/hermes-2-pro-mistral-7b",
			{
				messages: [{ role: "user", content: "Who is Cloudflare on GitHub?" }],
				tools: [
					{
						name: "getGithubUser",
						description:
							"Provides publicly available information about someone with a GitHub account.",
						parameters: {
							type: "object",
							properties: {
								username: {
									type: "string",
									description: "The handle for the GitHub user account.",
								},
							},
							required: ["username"],
						},
					},
				],
			},
		);

		const selected_tool = response.tool_calls[0];
		let res;

		if (selected_tool.name == "getGithubUser") {
			try {
				const username = selected_tool.arguments.username;
				const url = `https://api.github.com/users/${username}`;
				res = await fetch(url, {
					headers: {
						// Github API requires a User-Agent header
						"User-Agent":
							"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
					},
				}).then((res) => res.json());
			} catch (error) {
				return error;
			}
		}

		const finalResponse = await env.AI.run(
			"@hf/nousresearch/hermes-2-pro-mistral-7b",
			{
				messages: [
					{
						role: "user",
						content: "Who is Cloudflare on GitHub?",
					},
					{
						role: "assistant",
						content: JSON.stringify(selected_tool),
					},
					{
						role: "tool",
						content: JSON.stringify(res),
					},
				],
				tools: [
					{
						name: "getGithubUser",
						description:
							"Provides publicly available information about someone with a GitHub account.",
						parameters: {
							type: "object",
							properties: {
								username: {
									type: "string",
									description: "The handle for the GitHub user account.",
								},
							},
							required: ["username"],
						},
					},
				],
			},
		);
		return new Response(JSON.stringify(finalResponse));
	},
};
```

</TabItem> </Tabs>

## What models support function calling?

There are open-source models which have been fine-tuned to do function calling. When browsing our [model catalog](/workers-ai/models/), look for models with the function calling property beside it. For example, [@hf/nousresearch/hermes-2-pro-mistral-7b](/workers-ai/models/hermes-2-pro-mistral-7b/) is a fine-tuned variant of Mistral 7B that you can use for function calling.

---

# Traditional

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/traditional/

This page shows how you can do traditional function calling, as defined by industry standards. Workers AI also offers [embedded function calling](/workers-ai/features/function-calling/embedded/), which is drastically easier than traditional function calling.

With traditional function calling, you define an array of tools with the name, description, and tool arguments. The example below shows how you would pass a tool called `getWeather` in an inference request to a model.

```js title="Traditional function calling example"
const response = await env.AI.run("@hf/nousresearch/hermes-2-pro-mistral-7b", {
	messages: [
		{
			role: "user",
			content: "what is the weather in london?",
		},
	],
	tools: [
		{
			name: "getWeather",
			description: "Return the weather for a latitude and longitude",
			parameters: {
				type: "object",
				properties: {
					latitude: {
						type: "string",
						description: "The latitude for the given location",
					},
					longitude: {
						type: "string",
						description: "The longitude for the given location",
					},
				},
				required: ["latitude", "longitude"],
			},
		},
	],
});

return new Response(JSON.stringify(response.tool_calls));
```

The LLM will then return a JSON object with the required arguments and the name of the tool that was called. You can then pass this JSON object to make an API call.

```json
[
	{
		"arguments": { "latitude": "51.5074", "longitude": "-0.1278" },
		"name": "getWeather"
	}
]
```

For a working example on how to do function calling, take a look at our [demo app](https://github.com/craigsdennis/lightbulb-moment-tool-calling/blob/main/src/index.ts).

---

# Build a Retrieval Augmented Generation (RAG) AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-retrieval-augmented-generation-ai/

import { Details, Render, PackageManagers, WranglerConfig } from "~/components";

This guide will instruct you through setting up and deploying your first application with Cloudflare AI. You will build a fully-featured AI-powered application, using tools like Workers AI, Vectorize, D1, and Cloudflare Workers.

:::note[Looking for a managed option?]
[AutoRAG](/autorag) offers a fully managed way to build RAG pipelines on Cloudflare, handling ingestion, indexing, and querying out of the box. [Get started](/autorag/get-started/).
:::

At the end of this tutorial, you will have built an AI tool that allows you to store information and query it using a Large Language Model. This pattern, known as Retrieval Augmented Generation, or RAG, is a useful project you can build by combining multiple aspects of Cloudflare's AI toolkit. You do not need to have experience working with AI tools to build this application.

<Render file="prereqs" product="workers" />

You will also need access to [Vectorize](/vectorize/platform/pricing/). During this tutorial, we will show how you can optionally integrate with [Anthropic Claude](http://anthropic.com) as well. You will need an [Anthropic API key](https://docs.anthropic.com/en/api/getting-started) to do so.

## 1. Create a new Worker project

C3 (`create-cloudflare-cli`) is a command-line tool designed to help you setup and deploy Workers to Cloudflare as fast as possible.

Open a terminal window and run C3 to create your Worker project:

<PackageManagers
	type="create"
	pkg="cloudflare@latest"
	args={"rag-ai-tutorial"}
/>

<Render
	file="c3-post-run-steps"
	product="workers"
	params={{
		category: "hello-world",
		type: "Worker only",
		lang: "JavaScript",
	}}
/>

In your project directory, C3 has generated several files.

<Details header="What files did C3 create?">

1. `wrangler.jsonc`: Your [Wrangler](/workers/wrangler/configuration/#sample-wrangler-configuration) configuration file.
2. `worker.js` (in `/src`): A minimal `'Hello World!'` Worker written in [ES module](/workers/reference/migrate-to-module-workers/) syntax.
3. `package.json`: A minimal Node dependencies configuration file.
4. `package-lock.json`: Refer to [`npm` documentation on `package-lock.json`](https://docs.npmjs.com/cli/v9/configuring-npm/package-lock-json).
5. `node_modules`: Refer to [`npm` documentation `node_modules`](https://docs.npmjs.com/cli/v7/configuring-npm/folders#node-modules).

</Details>

Now, move into your newly created directory:

```sh
cd rag-ai-tutorial
```

## 2. Develop with Wrangler CLI

The Workers command-line interface, [Wrangler](/workers/wrangler/install-and-update/), allows you to [create](/workers/wrangler/commands/#init), [test](/workers/wrangler/commands/#dev), and [deploy](/workers/wrangler/commands/#deploy) your Workers projects. C3 will install Wrangler in projects by default.

After you have created your first Worker, run the [`wrangler dev`](/workers/wrangler/commands/#dev) command in the project directory to start a local server for developing your Worker. This will allow you to test your Worker locally during development.

```sh
npx wrangler dev --remote
```

:::note

If you have not used Wrangler before, it will try to open your web browser to login with your Cloudflare account.

If you have issues with this step or you do not have access to a browser interface, refer to the [`wrangler login`](/workers/wrangler/commands/#login) documentation for more information.

:::

You will now be able to go to [http://localhost:8787](http://localhost:8787) to see your Worker running. Any changes you make to your code will trigger a rebuild, and reloading the page will show you the up-to-date output of your Worker.

## 3. Adding the AI binding

To begin using Cloudflare's AI products, you can add the `ai` block to the [Wrangler configuration file](/workers/wrangler/configuration/). This will set up a binding to Cloudflare's AI models in your code that you can use to interact with the available AI models on the platform.

This example features the [`@cf/meta/llama-3-8b-instruct` model](/workers-ai/models/llama-3-8b-instruct/), which generates text.

<WranglerConfig>

```toml
[ai]
binding = "AI"
```

</WranglerConfig>

Now, find the `src/index.js` file. Inside the `fetch` handler, you can query the `AI` binding:

```js
export default {
	async fetch(request, env, ctx) {
		const answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
			messages: [{ role: "user", content: `What is the square root of 9?` }],
		});

		return new Response(JSON.stringify(answer));
	},
};
```

By querying the LLM through the `AI` binding, we can interact directly with Cloudflare AI's large language models directly in our code. In this example, we are using the [`@cf/meta/llama-3-8b-instruct` model](/workers-ai/models/llama-3-8b-instruct/), which generates text.

You can deploy your Worker using `wrangler`:

```sh
npx wrangler deploy
```

Making a request to your Worker will now generate a text response from the LLM, and return it as a JSON object.

```sh
curl https://example.username.workers.dev
```

```sh output
{"response":"Answer: The square root of 9 is 3."}
```

## 4. Adding embeddings using Cloudflare D1 and Vectorize

Embeddings allow you to add additional capabilities to the language models you can use in your Cloudflare AI projects. This is done via **Vectorize**, Cloudflare's vector database.

To begin using Vectorize, create a new embeddings index using `wrangler`. This index will store vectors with 768 dimensions, and will use cosine similarity to determine which vectors are most similar to each other:

```sh
npx wrangler vectorize create vector-index --dimensions=768 --metric=cosine
```

Then, add the configuration details for your new Vectorize index to the [Wrangler configuration file](/workers/wrangler/configuration/):

<WranglerConfig>

```toml
# ... existing wrangler configuration

[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "vector-index"
```

</WranglerConfig>

A vector index allows you to store a collection of dimensions, which are floating point numbers used to represent your data. When you want to query the vector database, you can also convert your query into dimensions. **Vectorize** is designed to efficiently determine which stored vectors are most similar to your query.

To implement the searching feature, you must set up a D1 database from Cloudflare. In D1, you can store your app's data. Then, you change this data into a vector format. When someone searches and it matches the vector, you can show them the matching data.

Create a new D1 database using `wrangler`:

```sh
npx wrangler d1 create database
```

Then, paste the configuration details output from the previous command into the [Wrangler configuration file](/workers/wrangler/configuration/):

<WranglerConfig>

```toml
# ... existing wrangler configuration

[[d1_databases]]
binding = "DB" # available in your Worker on env.DB
database_name = "database"
database_id = "abc-def-geh" # replace this with a real database_id (UUID)
```

</WranglerConfig>

In this application, we'll create a `notes` table in D1, which will allow us to store notes and later retrieve them in Vectorize. To create this table, run a SQL command using `wrangler d1 execute`:

```sh
npx wrangler d1 execute database --remote --command "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)"
```

Now, we can add a new note to our database using `wrangler d1 execute`:

```sh
npx wrangler d1 execute database --remote --command "INSERT INTO notes (text) VALUES ('The best pizza topping is pepperoni')"
```

## 5. Creating a workflow

Before we begin creating notes, we will introduce a [Cloudflare Workflow](/workflows). This will allow us to define a durable workflow that can safely and robustly execute all the steps of the RAG process.

To begin, add a new `[[workflows]]` block to your [Wrangler configuration file](/workers/wrangler/configuration/):

<WranglerConfig>

```toml
# ... existing wrangler configuration

[[workflows]]
name = "rag"
binding = "RAG_WORKFLOW"
class_name = "RAGWorkflow"
```

</WranglerConfig>

In `src/index.js`, add a new class called `RAGWorkflow` that extends `WorkflowEntrypoint`:

```js
import { WorkflowEntrypoint } from "cloudflare:workers";

export class RAGWorkflow extends WorkflowEntrypoint {
	async run(event, step) {
		await step.do("example step", async () => {
			console.log("Hello World!");
		});
	}
}
```

This class will define a single workflow step that will log "Hello World!" to the console. You can add as many steps as you need to your workflow.

On its own, this workflow will not do anything. To execute the workflow, we will call the `RAG_WORKFLOW` binding, passing in any parameters that the workflow needs to properly complete. Here is an example of how we can call the workflow:

```js
env.RAG_WORKFLOW.create({ params: { text } });
```

## 6. Creating notes and adding them to Vectorize

To expand on your Workers function in order to handle multiple routes, we will add `hono`, a routing library for Workers. This will allow us to create a new route for adding notes to our database. Install `hono` using `npm`:

<PackageManagers pkg="hono" />

Then, import `hono` into your `src/index.js` file. You should also update the `fetch` handler to use `hono`:

```js
import { Hono } from "hono";
const app = new Hono();

app.get("/", async (c) => {
	const answer = await c.env.AI.run("@cf/meta/llama-3-8b-instruct", {
		messages: [{ role: "user", content: `What is the square root of 9?` }],
	});

	return c.json(answer);
});

export default app;
```

This will establish a route at the root path `/` that is functionally equivalent to the previous version of your application.

Now, we can update our workflow to begin adding notes to our database, and generating the related embeddings for them.

This example features the [`@cf/baai/bge-base-en-v1.5` model](/workers-ai/models/bge-base-en-v1.5/), which can be used to create an embedding. Embeddings are stored and retrieved inside [Vectorize](/vectorize/), Cloudflare's vector database. The user query is also turned into an embedding so that it can be used for searching within Vectorize.

```js
import { WorkflowEntrypoint } from "cloudflare:workers";

export class RAGWorkflow extends WorkflowEntrypoint {
	async run(event, step) {
		const env = this.env;
		const { text } = event.payload;

		const record = await step.do(`create database record`, async () => {
			const query = "INSERT INTO notes (text) VALUES (?) RETURNING *";

			const { results } = await env.DB.prepare(query).bind(text).run();

			const record = results[0];
			if (!record) throw new Error("Failed to create note");
			return record;
		});

		const embedding = await step.do(`generate embedding`, async () => {
			const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
				text: text,
			});
			const values = embeddings.data[0];
			if (!values) throw new Error("Failed to generate vector embedding");
			return values;
		});

		await step.do(`insert vector`, async () => {
			return env.VECTOR_INDEX.upsert([
				{
					id: record.id.toString(),
					values: embedding,
				},
			]);
		});
	}
}
```

The workflow does the following things:

1. Accepts a `text` parameter.
2. Insert a new row into the `notes` table in D1, and retrieve the `id` of the new row.
3. Convert the `text` into a vector using the `embeddings` model of the LLM binding.
4. Upsert the `id` and `vectors` into the `vector-index` index in Vectorize.

By doing this, you will create a new vector representation of the note, which can be used to retrieve the note later.

To complete the code, we will add a route that allows users to submit notes to the database. This route will parse the JSON request body, get the `note` parameter, and create a new instance of the workflow, passing the parameter:

```js
app.post("/notes", async (c) => {
	const { text } = await c.req.json();
	if (!text) return c.text("Missing text", 400);
	await c.env.RAG_WORKFLOW.create({ params: { text } });
	return c.text("Created note", 201);
});
```

## 7. Querying Vectorize to retrieve notes

To complete your code, you can update the root path (`/`) to query Vectorize. You will convert the query into a vector, and then use the `vector-index` index to find the most similar vectors.

The `topK` parameter limits the number of vectors returned by the function. For instance, providing a `topK` of 1 will only return the _most similar_ vector based on the query. Setting `topK` to 5 will return the 5 most similar vectors.

Given a list of similar vectors, you can retrieve the notes that match the record IDs stored alongside those vectors. In this case, we are only retrieving a single note - but you may customize this as needed.

You can insert the text of those notes as context into the prompt for the LLM binding. This is the basis of Retrieval-Augmented Generation, or RAG: providing additional context from data outside of the LLM to enhance the text generated by the LLM.

We'll update the prompt to include the context, and to ask the LLM to use the context when responding:

```js
import { Hono } from "hono";
const app = new Hono();

// Existing post route...
// app.post('/notes', async (c) => { ... })

app.get("/", async (c) => {
	const question = c.req.query("text") || "What is the square root of 9?";

	const embeddings = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
		text: question,
	});
	const vectors = embeddings.data[0];

	const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 1 });
	let vecId;
	if (
		vectorQuery.matches &&
		vectorQuery.matches.length > 0 &&
		vectorQuery.matches[0]
	) {
		vecId = vectorQuery.matches[0].id;
	} else {
		console.log("No matching vector found or vectorQuery.matches is empty");
	}

	let notes = [];
	if (vecId) {
		const query = `SELECT * FROM notes WHERE id = ?`;
		const { results } = await c.env.DB.prepare(query).bind(vecId).all();
		if (results) notes = results.map((vec) => vec.text);
	}

	const contextMessage = notes.length
		? `Context:\n${notes.map((note) => `- ${note}`).join("\n")}`
		: "";

	const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`;

	const { response: answer } = await c.env.AI.run(
		"@cf/meta/llama-3-8b-instruct",
		{
			messages: [
				...(notes.length ? [{ role: "system", content: contextMessage }] : []),
				{ role: "system", content: systemPrompt },
				{ role: "user", content: question },
			],
		},
	);

	return c.text(answer);
});

app.onError((err, c) => {
	return c.text(err);
});

export default app;
```

## 8. Adding Anthropic Claude model (optional)

If you are working with larger documents, you have the option to use Anthropic's [Claude models](https://claude.ai/), which have large context windows and are well-suited to RAG workflows.

To begin, install the `@anthropic-ai/sdk` package:

<PackageManagers pkg="@anthropic-ai/sdk" />

In `src/index.js`, you can update the `GET /` route to check for the `ANTHROPIC_API_KEY` environment variable. If it's set, we can generate text using the Anthropic SDK. If it isn't set, we'll fall back to the existing Workers AI code:

```js
import Anthropic from '@anthropic-ai/sdk';

app.get('/', async (c) => {
  // ... Existing code
	const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`

	let modelUsed: string = ""
	let response = null

	if (c.env.ANTHROPIC_API_KEY) {
		const anthropic = new Anthropic({
			apiKey: c.env.ANTHROPIC_API_KEY
		})

		const model = "claude-3-5-sonnet-latest"
		modelUsed = model

		const message = await anthropic.messages.create({
			max_tokens: 1024,
			model,
			messages: [
				{ role: 'user', content: question }
			],
			system: [systemPrompt, notes ? contextMessage : ''].join(" ")
		})

		response = {
			response: message.content.map(content => content.text).join("\n")
		}
	} else {
		const model = "@cf/meta/llama-3.1-8b-instruct"
		modelUsed = model

		response = await c.env.AI.run(
			model,
			{
				messages: [
					...(notes.length ? [{ role: 'system', content: contextMessage }] : []),
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: question }
				]
			}
		)
	}

	if (response) {
		c.header('x-model-used', modelUsed)
		return c.text(response.response)
	} else {
		return c.text("We were unable to generate output", 500)
	}
})
```

Finally, you'll need to set the `ANTHROPIC_API_KEY` environment variable in your Workers application. You can do this by using `wrangler secret put`:

```sh
$ npx wrangler secret put ANTHROPIC_API_KEY
```

## 9. Deleting notes and vectors

If you no longer need a note, you can delete it from the database. Any time that you delete a note, you will also need to delete the corresponding vector from Vectorize. You can implement this by building a `DELETE /notes/:id` route in your `src/index.js` file:

```js
app.delete("/notes/:id", async (c) => {
	const { id } = c.req.param();

	const query = `DELETE FROM notes WHERE id = ?`;
	await c.env.DB.prepare(query).bind(id).run();

	await c.env.VECTOR_INDEX.deleteByIds([id]);

	return c.status(204);
});
```

## 10. Text splitting (optional)

For large pieces of text, it is recommended to split the text into smaller chunks. This allows LLMs to more effectively gather relevant context, without needing to retrieve large pieces of text.

To implement this, we'll add a new NPM package to our project, `@langchain/textsplitters':

<PackageManagers pkg="@langchain/textsplitters" />

The `RecursiveCharacterTextSplitter` class provided by this package will split the text into smaller chunks. It can be customized to your liking, but the default config works in most cases:

```js
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const text = "Some long piece of text...";

const splitter = new RecursiveCharacterTextSplitter({
	// These can be customized to change the chunking size
	// chunkSize: 1000,
	// chunkOverlap: 200,
});

const output = await splitter.createDocuments([text]);
console.log(output); // [{ pageContent: 'Some long piece of text...' }]
```

To use this splitter, we'll update the workflow to split the text into smaller chunks. We'll then iterate over the chunks and run the rest of the workflow for each chunk of text:

```js
export class RAGWorkflow extends WorkflowEntrypoint {
	async run(event, step) {
		const env = this.env;
		const { text } = event.payload;
		let texts = await step.do("split text", async () => {
			const splitter = new RecursiveCharacterTextSplitter();
			const output = await splitter.createDocuments([text]);
			return output.map((doc) => doc.pageContent);
		});

		console.log(
			"RecursiveCharacterTextSplitter generated ${texts.length} chunks",
		);

		for (const index in texts) {
			const text = texts[index];
			const record = await step.do(
				`create database record: ${index}/${texts.length}`,
				async () => {
					const query = "INSERT INTO notes (text) VALUES (?) RETURNING *";

					const { results } = await env.DB.prepare(query).bind(text).run();

					const record = results[0];
					if (!record) throw new Error("Failed to create note");
					return record;
				},
			);

			const embedding = await step.do(
				`generate embedding: ${index}/${texts.length}`,
				async () => {
					const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
						text: text,
					});
					const values = embeddings.data[0];
					if (!values) throw new Error("Failed to generate vector embedding");
					return values;
				},
			);

			await step.do(`insert vector: ${index}/${texts.length}`, async () => {
				return env.VECTOR_INDEX.upsert([
					{
						id: record.id.toString(),
						values: embedding,
					},
				]);
			});
		}
	}
}
```

Now, when large pieces of text are submitted to the `/notes` endpoint, they will be split into smaller chunks, and each chunk will be processed by the workflow.

## 11. Deploy your project

If you did not deploy your Worker during [step 1](/workers/get-started/guide/#1-create-a-new-worker-project), deploy your Worker via Wrangler, to a `*.workers.dev` subdomain, or a [Custom Domain](/workers/configuration/routing/custom-domains/), if you have one configured. If you have not configured any subdomain or domain, Wrangler will prompt you during the publish process to set one up.

```sh
npx wrangler deploy
```

Preview your Worker at `<YOUR_WORKER>.<YOUR_SUBDOMAIN>.workers.dev`.

:::note[Note]

When pushing to your `*.workers.dev` subdomain for the first time, you may see [`523` errors](/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-523/) while DNS is propagating. These errors should resolve themselves after a minute or so.

:::

## Related resources

A full version of this codebase is available on GitHub. It includes a frontend UI for querying, adding, and deleting notes, as well as a backend API for interacting with the database and vector index. You can find it here: [github.com/kristianfreeman/cloudflare-retrieval-augmented-generation-example](https://github.com/kristianfreeman/cloudflare-retrieval-augmented-generation-example/).

To do more:

- Explore the reference diagram for a [Retrieval Augmented Generation (RAG) Architecture](/reference-architecture/diagrams/ai/ai-rag/).
- Review Cloudflare's [AI documentation](/workers-ai).
- Review [Tutorials](/workers/tutorials/) to build projects on Workers.
- Explore [Examples](/workers/examples/) to experiment with copy and paste Worker code.
- Understand how Workers works in [Reference](/workers/reference/).
- Learn about Workers features and functionality in [Platform](/workers/platform/).
- Set up [Wrangler](/workers/wrangler/install-and-update/) to programmatically create, test, and deploy your Worker projects.

---

# Build a Voice Notes App with auto transcriptions using Workers AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-voice-notes-app-with-auto-transcription/

import { Render, PackageManagers, Tabs, TabItem } from "~/components";

In this tutorial, you will learn how to create a Voice Notes App with automatic transcriptions of voice recordings, and optional post-processing. The following tools will be used to build the application:

- Workers AI to transcribe the voice recordings, and for the optional post processing
- D1 database to store the notes
- R2 storage to store the voice recordings
- Nuxt framework to build the full-stack application
- Workers to deploy the project

## Prerequisites

To continue, you will need:

<Render file="prereqs" product="workers" />

## 1. Create a new Worker project

Create a new Worker project using the `c3` CLI with the `nuxt` framework preset.

<PackageManagers type="create" pkg="cloudflare@latest" args="voice-notes --framework=nuxt" />

### Install additional dependencies

Change into the newly created project directory

```sh
cd voice-notes
```

And install the following dependencies:

<PackageManagers pkg="@nuxt/ui @vueuse/core @iconify-json/heroicons" />

Then add the `@nuxt/ui` module to the `nuxt.config.ts` file:

```ts title="nuxt.config.ts"
export default defineNuxtConfig({
  //..

  modules: ['nitro-cloudflare-dev', '@nuxt/ui'],

  //..
})
```

### [Optional] Move to Nuxt 4 compatibility mode

Moving to Nuxt 4 compatibility mode ensures that your application remains forward-compatible with upcoming updates to Nuxt.

Create a new `app` folder in the project's root directory and move the `app.vue` file to it. Also, add the following to your `nuxt.config.ts` file:

```ts title="nuxt.config.ts"
export default defineNuxtConfig({
  //..

  future: {
    compatibilityVersion: 4,
  },

  //..
})
```

:::note
The rest of the tutorial will use the `app` folder for keeping the client side code. If you did not make this change, you should continue to use the project's root directory.
:::

### Start local development server

At this point you can test your application by starting a local development server using:

<PackageManagers type="run" args="dev" />

If everything is set up correctly, you should see a Nuxt welcome page at `http://localhost:3000`.

## 2. Create the transcribe API endpoint

This API makes use of Workers AI to transcribe the voice recordings. To use Workers AI within your project, you first need to bind it to the Worker.

<Render file="ai-local-usage-charges" product="workers" />

Add the `AI` binding to the Wrangler file.

```toml title="wrangler.toml"
[ai]
binding = "AI"
```

Once the `AI` binding has been configured, run the `cf-typegen` command to generate the necessary Cloudflare type definitions. This makes the types definitions available in the server event contexts.

<PackageManagers type="run" args="cf-typegen" />

Create a transcribe `POST` endpoint by creating `transcribe.post.ts` file inside the `/server/api` directory.

```ts title="server/api/transcribe.post.ts"
export default defineEventHandler(async (event) => {
  const { cloudflare } = event.context;

  const form = await readFormData(event);
  const blob = form.get('audio') as Blob;
  if (!blob) {
    throw createError({
      statusCode: 400,
      message: 'Missing audio blob to transcribe',
    });
  }

  try {
    const response = await cloudflare.env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(await blob.arrayBuffer())],
    });

    return response.text;
  } catch (err) {
    console.error('Error transcribing audio:', err);
    throw createError({
      statusCode: 500,
      message: 'Failed to transcribe audio. Please try again.',
    });
  }
});
```

The above code does the following:

1. Extracts the audio blob from the event.
2. Transcribes the blob using the `@cf/openai/whisper` model and returns the transcription text as response.

## 3. Create an API endpoint for uploading audio recordings to R2

Before uploading the audio recordings to `R2`, you need to create a bucket first. You will also need to add the R2 binding to your Wrangler file and regenerate the Cloudflare type definitions.

Create an `R2` bucket.

<PackageManagers type="exec" pkg="wrangler" args="r2 bucket create <BUCKET_NAME>" />

Add the storage binding to your Wrangler file.

```toml title="wrangler.toml"
[[r2_buckets]]
binding = "R2"
bucket_name = "<BUCKET_NAME>"
```

Finally, generate the type definitions by rerunning the `cf-typegen` script.

Now you are ready to create the upload endpoint. Create a new `upload.put.ts` file in your `server/api` directory, and add the following code to it:

```ts title="server/api/upload.put.ts"
export default defineEventHandler(async (event) => {
  const { cloudflare } = event.context;

  const form = await readFormData(event);
  const files = form.getAll('files') as File[];
  if (!files) {
    throw createError({ statusCode: 400, message: 'Missing files' });
  }

  const uploadKeys: string[] = [];
  for (const file of files) {
    const obj = await cloudflare.env.R2.put(`recordings/${file.name}`, file);
    if (obj) {
      uploadKeys.push(obj.key);
    }
  }

  return uploadKeys;
});
```

The above code does the following:

1. The files variable retrieves all files sent by the client using form.getAll(), which allows for multiple uploads in a single request.
2. Uploads the files to the R2 bucket using the binding (`R2`) you created earlier.

:::note
The `recordings/` prefix organizes uploaded files within a dedicated folder in your bucket. This will also come in handy when serving these recordings to the client (covered later).
:::

## 4. Create an API endpoint to save notes entries

Before creating the endpoint, you will need to perform steps similar to those for the R2 bucket, with some additional steps to prepare a notes table.

Create a `D1` database.

<PackageManagers type="exec" pkg="wrangler" args="d1 create <DB_NAME>" />

Add the D1 bindings to the Wrangler file. You can get the `DB_ID` from the output of the `d1 create` command.

```toml title="wrangler.toml"
[[d1_databases]]
binding = "DB"
database_name = "<DB_NAME>"
database_id = "<DB_ID>"
```

As before, rerun the `cf-typegen` command to generate the types.

Next, create a DB migration.

<PackageManagers type="exec" pkg="wrangler" args={`d1 migrations create <DB_NAME> "create notes table"`} />

This will create a new `migrations` folder in the project's root directory, and add an empty `0001_create_notes_table.sql` file to it. Replace the contents of this file with the code below.

```sql
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 text TEXT NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 audio_urls TEXT
);
```

And then apply this migration to create the `notes` table.

<PackageManagers type="exec" pkg="wrangler" args="d1 migrations apply <DB_NAME>" />

:::note
The above command will create the notes table locally. To apply the migration on your remote production database, use the `--remote` flag.
:::

Now you can create the API endpoint. Create a new file `index.post.ts` in the `server/api/notes` directory, and change its content to the following:

```ts title="server/api/notes/index.post.ts"
export default defineEventHandler(async (event) => {
  const { cloudflare } = event.context;

  const { text, audioUrls } = await readBody(event);
  if (!text) {
    throw createError({
      statusCode: 400,
      message: 'Missing note text',
    });
  }

  try {
    await cloudflare.env.DB.prepare(
      'INSERT INTO notes (text, audio_urls) VALUES (?1, ?2)'
    )
      .bind(text, audioUrls ? JSON.stringify(audioUrls) : null)
      .run();

    return setResponseStatus(event, 201);
  } catch (err) {
    console.error('Error creating note:', err);
    throw createError({
      statusCode: 500,
      message: 'Failed to create note. Please try again.',
    });
  }
});
```

The above does the following:

1. Extracts the text, and optional audioUrls from the event.
2. Saves it to the database after converting the audioUrls to a `JSON` string.

## 5. Handle note creation on the client-side

Now you're ready to work on the client side. Let's start by tackling the note creation part first.

### Recording user audio

Create a composable to handle audio recording using the MediaRecorder API. This will be used to record notes through the user's microphone.

Create a new file `useMediaRecorder.ts` in the `app/composables` folder, and add the following code to it:

```ts title="app/composables/useMediaRecorder.ts"
interface MediaRecorderState {
  isRecording: boolean;
  recordingDuration: number;
  audioData: Uint8Array | null;
  updateTrigger: number;
}

export function useMediaRecorder() {
  const state = ref<MediaRecorderState>({
    isRecording: false,
    recordingDuration: 0,
    audioData: null,
    updateTrigger: 0,
  });

  let mediaRecorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let animationFrame: number | null = null;
  let audioChunks: Blob[] | undefined = undefined;

  const updateAudioData = () => {
    if (!analyser || !state.value.isRecording || !state.value.audioData) {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }

      return;
    }

    analyser.getByteTimeDomainData(state.value.audioData);
    state.value.updateTrigger += 1;
    animationFrame = requestAnimationFrame(updateAudioData);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e: BlobEvent) => {
        audioChunks?.push(e.data);
        state.value.recordingDuration += 1;
      };

      state.value.audioData = new Uint8Array(analyser.frequencyBinCount);
      state.value.isRecording = true;
      state.value.recordingDuration = 0;
      state.value.updateTrigger = 0;
      mediaRecorder.start(1000);

      updateAudioData();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      throw err;
    }
  };

  const stopRecording = async () => {
    return await new Promise<Blob>((resolve) => {
      if (mediaRecorder && state.value.isRecording) {
        mediaRecorder.onstop = () => {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          audioChunks = undefined;

          state.value.recordingDuration = 0;
          state.value.updateTrigger = 0;
          state.value.audioData = null;

          resolve(blob);
        };

        state.value.isRecording = false;
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());

        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }

        audioContext?.close();
        audioContext = null;
      }
    });
  };

  onUnmounted(() => {
    stopRecording();
  });

  return {
    state: readonly(state),
    startRecording,
    stopRecording,
  };
}
```

The above code does the following:

1. Exposes functions to start and stop audio recordings in a Vue application.
2. Captures audio input from the user's microphone using MediaRecorder API.
3. Processes real-time audio data for visualization using AudioContext and AnalyserNode.
4. Stores recording state including duration and recording status.
5. Maintains chunks of audio data and combines them into a final audio blob when recording stops.
6. Updates audio visualization data continuously using animation frames while recording.
7. Automatically cleans up all audio resources when recording stops or component unmounts.
8. Returns audio recordings in webm format for further processing.

### Create a component for note creation

This component allows users to create notes by either typing or recording audio. It also handles audio transcription and uploading the recordings to the server.

Create a new file named `CreateNote.vue` inside the `app/components` folder. Add the following template code to the newly created file:

```vue title="app/components/CreateNote.vue"
<template>
  <div class="flex flex-col gap-y-5">
    <div
      class="flex flex-col h-full md:flex-row gap-y-4 md:gap-x-6 overflow-hidden p-px"
    >
      <UCard
        :ui="{
          base: 'h-full flex flex-col flex-1',
          body: { base: 'flex-grow' },
          header: { base: 'md:h-[72px]' },
        }"
      >
        <template #header>
          <h3
            class="text-base md:text-lg font-medium text-gray-600 dark:text-gray-300"
          >
            Note transcript
          </h3>
        </template>
        <UTextarea
          v-model="note"
          placeholder="Type your note or use voice recording..."
          size="lg"
          autofocus
          :disabled="loading || isTranscribing || state.isRecording"
          :rows="10"
        />
      </UCard>

      <UCard
        class="md:h-full md:flex md:flex-col md:w-96 shrink-0 order-first md:order-none"
        :ui="{
          body: { base: 'max-h-36 md:max-h-none md:flex-grow overflow-y-auto' },
        }"
      >
        <template #header>
          <h3
            class="text-base md:text-lg font-medium text-gray-600 dark:text-gray-300"
          >
            Note recordings
          </h3>

          <UTooltip
            :text="state.isRecording ? 'Stop Recording' : 'Start Recording'"
          >
            <UButton
              :icon="
                state.isRecording
                  ? 'i-heroicons-stop-circle'
                  : 'i-heroicons-microphone'
              "
              :color="state.isRecording ? 'red' : 'primary'"
              :loading="isTranscribing"
              @click="toggleRecording"
            />
          </UTooltip>
        </template>

        <AudioVisualizer
          v-if="state.isRecording"
          class="w-full h-14 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg mb-2"
          :audio-data="state.audioData"
          :data-update-trigger="state.updateTrigger"
        />

        <div
          v-else-if="isTranscribing"
          class="flex items-center justify-center h-14 gap-x-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg mb-2 text-gray-500 dark:text-gray-400"
        >
          <UIcon
            name="i-heroicons-arrow-path-20-solid"
            class="w-6 h-6 animate-spin"
          />
          Transcribing...
        </div>

        <RecordingsList :recordings="recordings" @delete="deleteRecording" />

        <div
          v-if="!recordings.length && !state.isRecording && !isTranscribing"
          class="h-full flex items-center justify-center text-gray-500 dark:text-gray-400"
        >
          No recordings...
        </div>
      </UCard>
    </div>

    <UDivider />

    <div class="flex justify-end gap-x-4">
      <UButton
        icon="i-heroicons-trash"
        color="gray"
        size="lg"
        variant="ghost"
        :disabled="loading"
        @click="clearNote"
      >
        Clear
      </UButton>
      <UButton
        icon="i-heroicons-cloud-arrow-up"
        size="lg"
        :loading="loading"
        :disabled="!note.trim() && !state.isRecording"
        @click="saveNote"
      >
        Save
      </UButton>
    </div>
  </div>
</template>
```

The above template results in the following:

1. A panel with a `textarea` inside to type the note manually.
2. Another panel to manage start/stop of an audio recording, and show the recordings done already.
3. A bottom panel to reset or save the note (along with the recordings).

Now, add the following code below the template code in the same file:

```vue title="app/components/CreateNote.vue"
<script setup lang="ts">
import type { Recording, Settings } from '~~/types';

const emit = defineEmits<{
  (e: 'created'): void;
}>();

const note = ref('');
const loading = ref(false);
const isTranscribing = ref(false);
const { state, startRecording, stopRecording } = useMediaRecorder();
const recordings = ref<Recording[]>([]);

const handleRecordingStart = async () => {
  try {
    await startRecording();
  } catch (err) {
    console.error('Error accessing microphone:', err);
    useToast().add({
      title: 'Error',
      description: 'Could not access microphone. Please check permissions.',
      color: 'red',
    });
  }
};

const handleRecordingStop = async () => {
  let blob: Blob | undefined;

  try {
    blob = await stopRecording();
  } catch (err) {
    console.error('Error stopping recording:', err);
    useToast().add({
      title: 'Error',
      description: 'Failed to record audio. Please try again.',
      color: 'red',
    });
  }

  if (blob) {
    try {
      const transcription = await transcribeAudio(blob);

      note.value += note.value ? '\n\n' : '';
      note.value += transcription ?? '';

      recordings.value.unshift({
        url: URL.createObjectURL(blob),
        blob,
        id: `${Date.now()}`,
      });
    } catch (err) {
      console.error('Error transcribing audio:', err);
      useToast().add({
        title: 'Error',
        description: 'Failed to transcribe audio. Please try again.',
        color: 'red',
      });
    }
  }
};

const toggleRecording = () => {
  if (state.value.isRecording) {
    handleRecordingStop();
  } else {
    handleRecordingStart();
  }
};

const transcribeAudio = async (blob: Blob) => {
  try {
    isTranscribing.value = true;
    const formData = new FormData();
    formData.append('audio', blob);

    return await $fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });
  } finally {
    isTranscribing.value = false;
  }
};

const clearNote = () => {
  note.value = '';
  recordings.value = [];
};

const saveNote = async () => {
  if (!note.value.trim()) return;

  loading.value = true;

  const noteToSave: { text: string; audioUrls?: string[] } = {
    text: note.value.trim(),
  };

  try {
    if (recordings.value.length) {
      noteToSave.audioUrls = await uploadRecordings();
    }

    await $fetch('/api/notes', {
      method: 'POST',
      body: noteToSave,
    });

    useToast().add({
      title: 'Success',
      description: 'Note saved successfully',
      color: 'green',
    });

    note.value = '';
    recordings.value = [];

    emit('created');
  } catch (err) {
    console.error('Error saving note:', err);
    useToast().add({
      title: 'Error',
      description: 'Failed to save note',
      color: 'red',
    });
  } finally {
    loading.value = false;
  }
};

const deleteRecording = (recording: Recording) => {
  recordings.value = recordings.value.filter((r) => r.id !== recording.id);
};

const uploadRecordings = async () => {
  if (!recordings.value.length) return;

  const formData = new FormData();
  recordings.value.forEach((recording) => {
    formData.append('files', recording.blob, recording.id + '.webm');
  });

  const uploadKeys = await $fetch('/api/upload', {
    method: 'PUT',
    body: formData,
  });

  return uploadKeys;
};
</script>
```

The above code does the following:

1. When a recording is stopped by calling `handleRecordingStop` function, the audio blob is sent for transcribing to the transcribe API endpoint.
2. The transcription response text is appended to the existing textarea content.
3. When the note is saved by calling the `saveNote` function, the audio recordings are uploaded first to R2 by using the upload endpoint we created earlier. Then, the actual note content along with the audioUrls (the R2 object keys) are saved by calling the notes post endpoint.

### Create a new page route for showing the component

You can use this component in a Nuxt page to show it to the user. But before that you need to modify your `app.vue` file. Update the content of your `app.vue` to the following:

```vue title="/app/app.vue"
<template>
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator />
  <div class="h-screen flex flex-col md:flex-row">
    <USlideover
      v-model="isDrawerOpen"
      class="md:hidden"
      side="left"
      :ui="{ width: 'max-w-xs' }"
    >
      <AppSidebar :links="links" @hide-drawer="isDrawerOpen = false" />
    </USlideover>

    <!-- The App Sidebar -->
    <AppSidebar :links="links" class="hidden md:block md:w-64" />

    <div class="flex-1 h-full min-w-0 bg-gray-50 dark:bg-gray-950">
      <!-- The App Header -->
      <AppHeader :title="title" @show-drawer="isDrawerOpen = true">
        <template #actions v-if="route.path === '/'">
          <UButton icon="i-heroicons-plus" @click="navigateTo('/new')">
            New Note
          </UButton>
        </template>
      </AppHeader>

      <!-- Main Page Content -->
      <main class="p-4 sm:p-6 h-[calc(100vh-3.5rem)] overflow-y-auto">
        <NuxtPage />
      </main>
    </div>
  </div>
  <UNotifications />
</template>

<script setup lang="ts">
const isDrawerOpen = ref(false);
const links = [
  {
    label: 'Notes',
    icon: 'i-heroicons-document-text',
    to: '/',
    click: () => (isDrawerOpen.value = false),
  },
  {
    label: 'Settings',
    icon: 'i-heroicons-cog',
    to: '/settings',
    click: () => (isDrawerOpen.value = false),
  },
];

const route = useRoute();
const title = computed(() => {
  const activeLink = links.find((l) => l.to === route.path);
  if (activeLink) {
    return activeLink.label;
  }

  return '';
});
</script>
```

The above code allows for a nuxt page to be shown to the user, apart from showing an app header and a navigation sidebar.

Next, add a new file named `new.vue` inside the `app/pages` folder, add the following code to it:

```vue title="app/pages/new.vue"
<template>
  <UModal v-model="isOpen" fullscreen>
    <UCard
      :ui="{
        base: 'h-full flex flex-col',
        rounded: '',
        body: {
          base: 'flex-grow overflow-hidden',
        },
      }"
    >
      <template #header>
        <h2 class="text-xl md:text-2xl font-semibold leading-6">Create note</h2>
        <UButton
          color="gray"
          variant="ghost"
          icon="i-heroicons-x-mark-20-solid"
          @click="closeModal"
        />
      </template>

      <CreateNote class="max-w-7xl mx-auto h-full" @created="closeModal" />
    </UCard>
  </UModal>
</template>

<script setup lang="ts">
const isOpen = ref(true);

const router = useRouter();
const closeModal = () => {
  isOpen.value = false;

  if (window.history.length > 2) {
    router.back();
  } else {
    navigateTo({
      path: '/',
      replace: true,
    });
  }
};
</script>
```

The above code shows the `CreateNote` component inside a modal, and navigates back to the home page on successful note creation.

## 6. Showing the notes on the client side

To show the notes from the database on the client side, create an API endpoint first that will interact with the database.

### Create an API endpoint to fetch notes from the database

Create a new file named `index.get.ts` inside the `server/api/notes` directory, and add the following code to it:

```ts title="server/api/index.get.ts"
import type { Note } from '~~/types';

export default defineEventHandler(async (event) => {
  const { cloudflare } = event.context;

  const res = await cloudflare.env.DB.prepare(
    `SELECT
      id,
      text,
      audio_urls AS audioUrls,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM notes
    ORDER BY created_at DESC
    LIMIT 50;`
  ).all<Omit<Note, 'audioUrls'> & { audioUrls: string | null }>();

  return res.results.map((note) => ({
    ...note,
    audioUrls: note.audioUrls ? JSON.parse(note.audioUrls) : undefined,
  }));
});
```

The above code fetches the last 50 notes from the database, ordered by their creation date in descending order. The `audio_urls` field is stored as a string in the database, but it's converted to an array using `JSON.parse` to handle multiple audio files seamlessly on the client side.

Next, create a page named `index.vue` inside the `app/pages` directory. This will be the home page of the application. Add the following code to it:

```vue title="app/pages/index.vue"
<template>
  <div :class="{ 'flex h-full': !notes?.length }">
    <div v-if="notes?.length" class="space-y-4 sm:space-y-6">
      <NoteCard v-for="note in notes" :key="note.id" :note="note" />
    </div>
    <div
      v-else
      class="flex-1 self-center text-center text-gray-500 dark:text-gray-400 space-y-2"
    >
      <h2 class="text-2xl md:text-3xl">No notes created</h2>
      <p>Get started by creating your first note</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Note } from '~~/types';

const { data: notes } = await useFetch<Note[]>('/api/notes');
</script>
```

The above code fetches the notes from the database by calling the `/api/notes` endpoint you created just now, and renders them as note cards.

### Serving the saved recordings from R2

To be able to play the audio recordings of these notes, you need to serve the saved recordings from the R2 storage.

Create a new file named `[...pathname].get.ts` inside the `server/routes/recordings` directory, and add the following code to it:

:::note
The `...` prefix in the file name makes it a catch all route. This allows it to receive all events that are meant for paths starting with `/recordings` prefix. This is where the `recordings` prefix that was added previously while saving the recordings becomes helpful.
:::

```ts title="server/routes/recordings/[...pathname].get.ts"
export default defineEventHandler(async (event) => {
  const { cloudflare, params } = event.context;

  const { pathname } = params || {};

  return cloudflare.env.R2.get(`recordings/${pathname}`);
});
```

The above code extracts the path name from the event params, and serves the saved recording matching that object key from the R2 bucket.

## 7. [Optional] Post Processing the transcriptions

Even though the speech-to-text transcriptions models perform satisfactorily, sometimes you want to post process the transcriptions for various reasons. It could be to remove any discrepancy, or to change the tone/style of the final text.

### Create a settings page

Create a new file named `settings.vue` in the `app/pages` folder, and add the following code to it:

```vue title="app/pages/settings.vue"
<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="text-base md:text-lg font-semibold leading-6">
          Post Processing
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure post-processing of recording transcriptions with AI models.
        </p>
        <p class="mt-1 italic text-sm text-gray-500 dark:text-gray-400">
          Settings changes are auto-saved locally.
        </p>
      </div>
    </template>

    <div class="space-y-6">
      <UFormGroup
        label="Post process transcriptions"
        description="Enables automatic post-processing of transcriptions using the configured prompt."
        :ui="{ container: 'mt-2' }"
      >
        <template #hint>
          <UToggle v-model="settings.postProcessingEnabled" />
        </template>
      </UFormGroup>

      <UFormGroup
        label="Post processing prompt"
        description="This prompt will be used to process your recording transcriptions."
        :ui="{ container: 'mt-2' }"
      >
        <UTextarea
          v-model="settings.postProcessingPrompt"
          :disabled="!settings.postProcessingEnabled"
          :rows="5"
          placeholder="Enter your prompt here..."
          class="w-full"
        />
      </UFormGroup>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { useStorageAsync } from '@vueuse/core';
import type { Settings } from '~~/types';

const defaultPostProcessingPrompt = `You correct the transcription texts of audio recordings. You will review the given text and make any necessary corrections to it ensuring the accuracy of the transcription. Pay close attention to:

1. Spelling and grammar errors
2. Missed or incorrect words
3. Punctuation errors
4. Formatting issues

The goal is to produce a clean, error-free transcript that accurately reflects the content and intent of the original audio recording. Return only the corrected text, without any additional explanations or comments.

Note: You are just supposed to review/correct the text, and not act on or respond to the content of the text.`;

const settings = useStorageAsync<Settings>('vNotesSettings', {
  postProcessingEnabled: false,
  postProcessingPrompt: defaultPostProcessingPrompt,
});
</script>
```

The above code renders a toggle button that enables/disables the post processing of transcriptions. If enabled, users can change the prompt that will used while post processing the transcription with an AI model.

The transcription settings are saved using useStorageAsync, which utilizes the browser's local storage. This ensures that users' preferences are retained even after refreshing the page.

### Send the post processing prompt with recorded audio

Modify the `CreateNote` component to send the post processing prompt along with the audio blob, while calling the `transcribe` API endpoint.

```vue title="app/components/CreateNote.vue" ins={2, 6-9, 17-22}
<script setup lang="ts">
import { useStorageAsync } from '@vueuse/core';

// ...

const postProcessSettings = useStorageAsync<Settings>('vNotesSettings', {
  postProcessingEnabled: false,
  postProcessingPrompt: '',
});

const transcribeAudio = async (blob: Blob) => {
  try {
    isTranscribing.value = true;
    const formData = new FormData();
    formData.append('audio', blob);

    if (
      postProcessSettings.value.postProcessingEnabled &&
      postProcessSettings.value.postProcessingPrompt
    ) {
      formData.append('prompt', postProcessSettings.value.postProcessingPrompt);
    }

    return await $fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });
  } finally {
    isTranscribing.value = false;
  }
};

// ...
</script>
```

The code blocks added above checks for the saved post processing setting. If enabled, and there is a defined prompt, it sends the prompt to the `transcribe` API endpoint.

### Handle post processing in the transcribe API endpoint

Modify the transcribe API endpoint, and update it to the following:

```ts title="server/api/transcribe.post.ts" ins={9-20, 22}
export default defineEventHandler(async (event) => {
  // ...

  try {
    const response = await cloudflare.env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(await blob.arrayBuffer())],
    });

    const postProcessingPrompt = form.get('prompt') as string;
    if (postProcessingPrompt && response.text) {
      const postProcessResult = await cloudflare.env.AI.run(
        '@cf/meta/llama-3.1-8b-instruct',
        {
          temperature: 0.3,
          prompt: `${postProcessingPrompt}.\n\nText:\n\n${response.text}\n\nResponse:`,
        }
      );

      return (postProcessResult as { response?: string }).response;
    } else {
      return response.text;
    }
  } catch (err) {
    // ...
  }
});
```

The above code does the following:

1. Extracts the post processing prompt from the event FormData.
2. If present, it calls the Workers AI API to process the transcription text using the `@cf/meta/llama-3.1-8b-instruct` model.
3. Finally, it returns the response from Workers AI to the client.

## 8. Deploy the application

Now you are ready to deploy the project to a `.workers.dev` sub-domain by running the deploy command.

<PackageManagers type="run" args="deploy" />

You can preview your application at `<YOUR_WORKER>.<YOUR_SUBDOMAIN>.workers.dev`.

:::note
If you used `pnpm` as your package manager, you may face build errors like `"stdin" is not exported by "node_modules/.pnpm/unenv@1.10.0/node_modules/unenv/runtime/node/process/index.mjs"`. To resolve it, you can try hoisting your node modules with the [`shamefully-hoist-true`](https://pnpm.io/npmrc) option.
:::

## Conclusion

In this tutorial, you have gone through the steps of building a voice notes application using Nuxt 3, Cloudflare Workers, D1, and R2 storage. You learnt to:

- Set up the backend to store and manage notes
- Create API endpoints to fetch and display notes
- Handle audio recordings
- Implement optional post-processing for transcriptions
- Deploy the application using the Cloudflare module syntax

The complete source code of the project is available on GitHub. You can go through it to see the code for various frontend components not covered in the article. You can find it here: [github.com/ra-jeev/vnotes](https://github.com/ra-jeev/vnotes).

---

# Whisper-large-v3-turbo with Cloudflare Workers AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/

In this tutorial you will learn how to:

- **Transcribe large audio files:** Use the [Whisper-large-v3-turbo](/workers-ai/models/whisper-large-v3-turbo/) model from Cloudflare Workers AI to perform automatic speech recognition (ASR) or translation.
- **Handle large files:** Split large audio files into smaller chunks for processing, which helps overcome memory and execution time limitations.
- **Deploy using Cloudflare Workers:** Create a scalable, low鈥憀atency transcription pipeline in a serverless environment.

## 1: Create a new Cloudflare Worker project

import { Render, PackageManagers, WranglerConfig } from "~/components";

<Render file="prereqs" product="workers" />

You will create a new Worker project using the `create-cloudflare` CLI (C3). [C3](https://github.com/cloudflare/workers-sdk/tree/main/packages/create-cloudflare) is a command-line tool designed to help you set up and deploy new applications to Cloudflare.

Create a new project named `whisper-tutorial` by running:

<PackageManagers
	type="create"
	pkg="cloudflare@latest"
	args={"whisper-tutorial"}
/>

Running `npm create cloudflare@latest` will prompt you to install the [`create-cloudflare` package](https://www.npmjs.com/package/create-cloudflare), and lead you through setup. C3 will also install [Wrangler](/workers/wrangler/), the Cloudflare Developer Platform CLI.

<Render
	file="c3-post-run-steps"
	product="workers"
	params={{
		category: "hello-world",
		type: "Worker only",
		lang: "TypeScript",
	}}
/>

This will create a new `whisper-tutorial` directory. Your new `whisper-tutorial` directory will include:

- A `"Hello World"` [Worker](/workers/get-started/guide/#3-write-code) at `src/index.ts`.
- A [`wrangler.jsonc`](/workers/wrangler/configuration/) configuration file.

Go to your application directory:

```sh
cd whisper-tutorial
```

## 2. Connect your Worker to Workers AI

You must create an AI binding for your Worker to connect to Workers AI. [Bindings](/workers/runtime-apis/bindings/) allow your Workers to interact with resources, like Workers AI, on the Cloudflare Developer Platform.

To bind Workers AI to your Worker, add the following to the end of your `wrangler.toml` file:

<WranglerConfig>

```toml
[ai]
binding = "AI"
```

</WranglerConfig>

Your binding is [available in your Worker code](/workers/reference/migrate-to-module-workers/#bindings-in-es-modules-format) on [`env.AI`](/workers/runtime-apis/handlers/fetch/).

## 3. Configure Wrangler

In your wrangler file, add or update the following settings to enable Node.js APIs and polyfills (with a compatibility date of 2024鈥�09鈥�23 or later):

<WranglerConfig>

```toml title="wrangler.toml"
compatibility_flags = [ "nodejs_compat" ]
compatibility_date = "2024-09-23"
```

</WranglerConfig>

## 4. Handle large audio files with chunking

Replace the contents of your `src/index.ts` file with the following integrated code. This sample demonstrates how to:

(1) Extract an audio file URL from the query parameters.

(2) Fetch the audio file while explicitly following redirects.

(3) Split the audio file into smaller chunks (such as, 1 MB chunks).

(4) Transcribe each chunk using the Whisper-large-v3-turbo model via the Cloudflare AI binding.

(5) Return the aggregated transcription as plain text.

```ts
import { Buffer } from "node:buffer";
import type { Ai } from "workers-ai";

export interface Env {
	AI: Ai;
	// If needed, add your KV namespace for storing transcripts.
	// MY_KV_NAMESPACE: KVNamespace;
}

/**
 * Fetches the audio file from the provided URL and splits it into chunks.
 * This function explicitly follows redirects.
 *
 * @param audioUrl - The URL of the audio file.
 * @returns An array of ArrayBuffers, each representing a chunk of the audio.
 */
async function getAudioChunks(audioUrl: string): Promise<ArrayBuffer[]> {
	const response = await fetch(audioUrl, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`Failed to fetch audio: ${response.status}`);
	}
	const arrayBuffer = await response.arrayBuffer();

	// Example: Split the audio into 1MB chunks.
	const chunkSize = 1024 * 1024; // 1MB
	const chunks: ArrayBuffer[] = [];
	for (let i = 0; i < arrayBuffer.byteLength; i += chunkSize) {
		const chunk = arrayBuffer.slice(i, i + chunkSize);
		chunks.push(chunk);
	}
	return chunks;
}

/**
 * Transcribes a single audio chunk using the Whisper鈥憀arge鈥憊3鈥憈urbo model.
 * The function converts the audio chunk to a Base64-encoded string and
 * sends it to the model via the AI binding.
 *
 * @param chunkBuffer - The audio chunk as an ArrayBuffer.
 * @param env - The Cloudflare Worker environment, including the AI binding.
 * @returns The transcription text from the model.
 */
async function transcribeChunk(
	chunkBuffer: ArrayBuffer,
	env: Env,
): Promise<string> {
	const base64 = Buffer.from(chunkBuffer, "binary").toString("base64");
	const res = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
		audio: base64,
		// Optional parameters (uncomment and set if needed):
		// task: "transcribe",   // or "translate"
		// language: "en",
		// vad_filter: "false",
		// initial_prompt: "Provide context if needed.",
		// prefix: "Transcription:",
	});
	return res.text; // Assumes the transcription result includes a "text" property.
}

/**
 * The main fetch handler. It extracts the 'url' query parameter, fetches the audio,
 * processes it in chunks, and returns the full transcription.
 */
export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		// Extract the audio URL from the query parameters.
		const { searchParams } = new URL(request.url);
		const audioUrl = searchParams.get("url");

		if (!audioUrl) {
			return new Response("Missing 'url' query parameter", { status: 400 });
		}

		// Get the audio chunks.
		const audioChunks: ArrayBuffer[] = await getAudioChunks(audioUrl);
		let fullTranscript = "";

		// Process each chunk and build the full transcript.
		for (const chunk of audioChunks) {
			try {
				const transcript = await transcribeChunk(chunk, env);
				fullTranscript += transcript + "\n";
			} catch (error) {
				fullTranscript += "[Error transcribing chunk]\n";
			}
		}

		return new Response(fullTranscript, {
			headers: { "Content-Type": "text/plain" },
		});
	},
} satisfies ExportedHandler<Env>;
```

## 5. Deploy your Worker

1. **Run the Worker locally:**

   Use wrangler's development mode to test your Worker locally:

```sh
npx wrangler dev
```

Open your browser and go to [http://localhost:8787](http://localhost:8787), or use curl:

```sh
curl "http://localhost:8787?url=https://raw.githubusercontent.com/your-username/your-repo/main/your-audio-file.mp3"
```

Replace the URL query parameter with the direct link to your audio file. (For GitHub-hosted files, ensure you use the raw file URL.)

2. **Deploy the Worker:**

   Once testing is complete, deploy your Worker with:

```sh
npx wrangler deploy
```

3. **Test the deployed Worker:**

   After deployment, test your Worker by passing the audio URL as a query parameter:

```sh
curl "https://<your-worker-subdomain>.workers.dev?url=https://raw.githubusercontent.com/your-username/your-repo/main/your-audio-file.mp3"
```

Make sure to replace `<your-worker-subdomain>`, `your-username`, `your-repo`, and `your-audio-file.mp3` with your actual details.

If successful, the Worker will return a transcript of the audio file:

```sh
This is the transcript of the audio...
```

---

# Build an interview practice tool with Workers AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/build-ai-interview-practice-tool/

import { Render, PackageManagers } from "~/components";

Job interviews can be stressful, and practice is key to building confidence. While traditional mock interviews with friends or mentors are valuable, they are not always available when you need them. In this tutorial, you will learn how to build an AI-powered interview practice tool that provides real-time feedback to help improve interview skills.

By the end of this tutorial, you will have built a complete interview practice tool with the following core functionalities:

- A real-time interview simulation tool using WebSocket connections
- An AI-powered speech processing pipeline that converts audio to text
- An intelligent response system that provides interviewer-like interactions
- A persistent storage system for managing interview sessions and history using Durable Objects

<Render file="tutorials-before-you-start" product="workers" />
<Render file="prereqs" product="workers" />

### Prerequisites

This tutorial demonstrates how to use multiple Cloudflare products and while many features are available in free tiers, some components of Workers AI may incur usage-based charges. Please review the pricing documentation for Workers AI before proceeding.

<Render file="ai-local-usage-charges" product="workers" />

## 1. Create a new Worker project

Create a Cloudflare Workers project using the Create Cloudflare CLI (C3) tool and the Hono framework.

:::note
[Hono](https://hono.dev) is a lightweight web framework that helps build API endpoints and handle HTTP requests. This tutorial uses Hono to create and manage the application's routing and middleware components.
:::

Create a new Worker project by running the following commands, using `ai-interview-tool` as the Worker name:

<PackageManagers
	type="create"
	pkg="cloudflare@latest"
	args={"ai-interview-tool"}
/>

<Render
	file="c3-post-run-steps"
	product="workers"
	params={{
		category: "web-framework",
		framework: "Hono",
	}}
/>

To develop and test your Cloudflare Workers application locally:

1. Navigate to your Workers project directory in your terminal:

```sh
cd ai-interview-tool
```

2. Start the development server by running:

```sh
npx wrangler dev
```

When you run `wrangler dev`, the command starts a local development server and provides a `localhost` URL where you can preview your application.
You can now make changes to your code and see them reflected in real-time at the provided localhost address.

## 2. Define TypeScript types for the interview system

Now that the project is set up, create the TypeScript types that will form the foundation of the interview system. These types will help you maintain type safety and provide clear interfaces for the different components of your application.

Create a new file `types.ts` that will contain essential types and enums for:

- Interview skills that can be assessed (JavaScript, React, etc.)
- Different interview positions (Junior Developer, Senior Developer, etc.)
- Interview status tracking
- Message handling between user and AI
- Core interview data structure

```typescript title="src/types.ts"
import { Context } from "hono";

// Context type for API endpoints, including environment bindings and user info
export interface ApiContext {
	Bindings: CloudflareBindings;
	Variables: {
		username: string;
	};
}

export type HonoCtx = Context<ApiContext>;

// List of technical skills you can assess during mock interviews.
// This application focuses on popular web technologies and programming languages
// that are commonly tested in real interviews.
export enum InterviewSkill {
	JavaScript = "JavaScript",
	TypeScript = "TypeScript",
	React = "React",
	NodeJS = "NodeJS",
	Python = "Python",
}

// Available interview types based on different engineering roles.
// This helps tailor the interview experience and questions to
// match the candidate's target position.
export enum InterviewTitle {
	JuniorDeveloper = "Junior Developer Interview",
	SeniorDeveloper = "Senior Developer Interview",
	FullStackDeveloper = "Full Stack Developer Interview",
	FrontendDeveloper = "Frontend Developer Interview",
	BackendDeveloper = "Backend Developer Interview",
	SystemArchitect = "System Architect Interview",
	TechnicalLead = "Technical Lead Interview",
}

// Tracks the current state of an interview session.
// This will help you to manage the interview flow and show appropriate UI/actions
// at each stage of the process.
export enum InterviewStatus {
	Created = "created", // Interview is created but not started
	Pending = "pending", // Waiting for interviewer/system
	InProgress = "in_progress", // Active interview session
	Completed = "completed", // Interview finished successfully
	Cancelled = "cancelled", // Interview terminated early
}

// Defines who sent a message in the interview chat
export type MessageRole = "user" | "assistant" | "system";

// Structure of individual messages exchanged during the interview
export interface Message {
	messageId: string; // Unique identifier for the message
	interviewId: string; // Links message to specific interview
	role: MessageRole; // Who sent the message
	content: string; // The actual message content
	timestamp: number; // When the message was sent
}

// Main data structure that holds all information about an interview session.
// This includes metadata, messages exchanged, and the current status.
export interface InterviewData {
	interviewId: string;
	title: InterviewTitle;
	skills: InterviewSkill[];
	messages: Message[];
	status: InterviewStatus;
	createdAt: number;
	updatedAt: number;
}

// Input format for creating a new interview session.
// Simplified interface that accepts basic parameters needed to start an interview.
export interface InterviewInput {
	title: string;
	skills: string[];
}
```

## 3. Configure error types for different services

Next, set up custom error types to handle different kinds of errors that may occur in your application. This includes:

- Database errors (for example, connection issues, query failures)
- Interview-related errors (for example, invalid input, transcription failures)
- Authentication errors (for example, invalid sessions)

Create the following `errors.ts` file:

```typescript title="src/errors.ts"
export const ErrorCodes = {
	INVALID_MESSAGE: "INVALID_MESSAGE",
	TRANSCRIPTION_FAILED: "TRANSCRIPTION_FAILED",
	LLM_FAILED: "LLM_FAILED",
	DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export class AppError extends Error {
	constructor(
		message: string,
		public statusCode: number,
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

export class UnauthorizedError extends AppError {
	constructor(message: string) {
		super(message, 401);
	}
}

export class BadRequestError extends AppError {
	constructor(message: string) {
		super(message, 400);
	}
}

export class NotFoundError extends AppError {
	constructor(message: string) {
		super(message, 404);
	}
}

export class InterviewError extends Error {
	constructor(
		message: string,
		public code: string,
		public statusCode: number = 500,
	) {
		super(message);
		this.name = "InterviewError";
	}
}
```

## 4. Configure authentication middleware and user routes

In this step, you will implement a basic authentication system to track and identify users interacting with your AI interview practice tool. The system uses HTTP-only cookies to store usernames, allowing you to identify both the request sender and their corresponding Durable Object. This straightforward authentication approach requires users to provide a username, which is then stored securely in a cookie. This approach allows you to:

- Identify users across requests
- Associate interview sessions with specific users
- Secure access to interview-related endpoints

### Create the Authentication Middleware

Create a middleware function that will check for the presence of a valid authentication cookie. This middleware will be used to protect routes that require authentication.

Create a new middleware file `middleware/auth.ts`:

```typescript title="src/middleware/auth.ts"
import { Context } from "hono";
import { getCookie } from "hono/cookie";
import { UnauthorizedError } from "../errors";

export const requireAuth = async (ctx: Context, next: () => Promise<void>) => {
	// Get username from cookie
	const username = getCookie(ctx, "username");

	if (!username) {
		throw new UnauthorizedError("User is not logged in");
	}

	// Make username available to route handlers
	ctx.set("username", username);
	await next();
};
```

This middleware:

- Checks for a `username` cookie
- Throws an `Error` if the cookie is missing
- Makes the username available to downstream handlers via the context

### Create Authentication Routes

Next, create the authentication routes that will handle user login. Create a new file `routes/auth.ts`:

```typescript title="src/routes/auth.ts"
import { Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { BadRequestError } from "../errors";
import { ApiContext } from "../types";

export const authenticateUser = async (ctx: Context) => {
	// Extract username from request body
	const { username } = await ctx.req.json();

	// Make sure username was provided
	if (!username) {
		throw new BadRequestError("Username is required");
	}

	// Create a secure cookie to track the user's session
	// This cookie will:
	// - Be HTTP-only for security (no JS access)
	// - Work across all routes via path="/"
	// - Last for 24 hours
	// - Only be sent in same-site requests to prevent CSRF
	setCookie(ctx, "username", username, {
		httpOnly: true,
		path: "/",
		maxAge: 60 * 60 * 24,
		sameSite: "Strict",
	});

	// Let the client know login was successful
	return ctx.json({ success: true });
};

// Set up authentication-related routes
export const configureAuthRoutes = () => {
	const router = new Hono<ApiContext>();

	// POST /login - Authenticate user and create session
	router.post("/login", authenticateUser);

	return router;
};
```

Finally, update main application file to include the authentication routes. Modify `src/index.ts`:

```typescript title="src/index.ts"
import { configureAuthRoutes } from "./routes/auth";
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { ApiContext } from "./types";
import { requireAuth } from "./middleware/auth";

// Create our main Hono app instance with proper typing
const app = new Hono<ApiContext>();

// Create a separate router for API endpoints to keep things organized
const api = new Hono<ApiContext>();

// Set up global middleware that runs on every request
// - Logger gives us visibility into what is happening
app.use("*", logger());

// Wire up all our authentication routes (login, etc)
// These will be mounted under /api/v1/auth/
api.route("/auth", configureAuthRoutes());

// Mount all API routes under the version prefix (for example, /api/v1)
// This allows us to make breaking changes in v2 without affecting v1 users
app.route("/api/v1", api);

export default app;
```

Now we have a basic authentication system that:

1. Provides a login endpoint at `/api/v1/auth/login`
2. Securely stores the username in a cookie
3. Includes middleware to protect authenticated routes

## 5. Create a Durable Object to manage interviews

Now that you have your authentication system in place, create a Durable Object to manage interview sessions. Durable Objects are perfect for this interview practice tool because they provide the following functionalities:

- Maintains states between connections, so users can reconnect without losing progress.
- Provides a SQLite database to store all interview Q&A, feedback and metrics.
- Enables smooth real-time interactions between the interviewer AI and candidate.
- Handles multiple interview sessions efficiently without performance issues.
- Creates a dedicated instance for each user, giving them their own isolated environment.

First, you will need to configure the Durable Object in Wrangler file. Add the following configuration:

```toml title="wrangler.toml"
[[durable_objects.bindings]]
name = "INTERVIEW"
class_name = "Interview"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Interview"]
```

Next, create a new file `interview.ts` to define our Interview Durable Object:

```typescript title="src/interview.ts"
import { DurableObject } from "cloudflare:workers";

export class Interview extends DurableObject<CloudflareBindings> {
	// We will use it to keep track of all active WebSocket connections for real-time communication
	private sessions: Map<WebSocket, { interviewId: string }>;

	constructor(state: DurableObjectState, env: CloudflareBindings) {
		super(state, env);

		// Initialize empty sessions map - we will add WebSocket connections as users join
		this.sessions = new Map();
	}

	// Entry point for all HTTP requests to this Durable Object
	// This will handle both initial setup and WebSocket upgrades
	async fetch(request: Request) {
		// For now, just confirm the object is working
		// We'll add WebSocket upgrade logic and request routing later
		return new Response("Interview object initialized");
	}

	// Broadcasts a message to all connected WebSocket clients.
	private broadcast(message: string) {
		this.ctx.getWebSockets().forEach((ws) => {
			try {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(message);
				}
			} catch (error) {
				console.error(
					"Error broadcasting message to a WebSocket client:",
					error,
				);
			}
		});
	}
}
```

Now we need to export the Durable Object in our main `src/index.ts` file:

```typescript title="src/index.ts"
import { Interview } from "./interview";

// ... previous code ...

export { Interview };

export default app;
```

Since the Worker code is written in TypeScript, you should run the following command to add the necessary type definitions:

```sh
npm run cf-typegen
```

### Set up SQLite database schema to store interview data

Now you will use SQLite at the Durable Object level for data persistence. This gives each user their own isolated database instance. You will need two main tables:

- `interviews`: Stores interview session data
- `messages`: Stores all messages exchanged during interviews

Before you create these tables, create a service class to handle your database operations. This encapsulates database logic and helps you:

- Manage database schema changes
- Handle errors consistently
- Keep database queries organized

Create a new file called `services/InterviewDatabaseService.ts`:

```typescript title="src/services/InterviewDatabaseService.ts"
import {
	InterviewData,
	Message,
	InterviewStatus,
	InterviewTitle,
	InterviewSkill,
} from "../types";
import { InterviewError, ErrorCodes } from "../errors";

const CONFIG = {
	database: {
		tables: {
			interviews: "interviews",
			messages: "messages",
		},
		indexes: {
			messagesByInterview: "idx_messages_interviewId",
		},
	},
} as const;

export class InterviewDatabaseService {
	constructor(private sql: SqlStorage) {}

	/**
	 * Sets up the database schema by creating tables and indexes if they do not exist.
	 * This is called when initializing a new Durable Object instance to ensure
	 * we have the required database structure.
	 *
	 * The schema consists of:
	 * - interviews table: Stores interview metadata like title, skills, and status
	 * - messages table: Stores the conversation history between user and AI
	 * - messages index: Helps optimize queries when fetching messages for a specific interview
	 */
	createTables() {
		try {
			// Get list of existing tables to avoid recreating them
			const cursor = this.sql.exec(`PRAGMA table_list`);
			const existingTables = new Set([...cursor].map((table) => table.name));

			// The interviews table is our main table storing interview sessions.
			// We only create it if it does not exist yet.
			if (!existingTables.has(CONFIG.database.tables.interviews)) {
				this.sql.exec(InterviewDatabaseService.QUERIES.CREATE_INTERVIEWS_TABLE);
			}

			// The messages table stores the actual conversation history.
			// It references interviews table via foreign key for data integrity.
			if (!existingTables.has(CONFIG.database.tables.messages)) {
				this.sql.exec(InterviewDatabaseService.QUERIES.CREATE_MESSAGES_TABLE);
			}

			// Add an index on interviewId to speed up message retrieval.
			// This is important since we will frequently query messages by interview.
			this.sql.exec(InterviewDatabaseService.QUERIES.CREATE_MESSAGE_INDEX);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new InterviewError(
				`Failed to initialize database: ${message}`,
				ErrorCodes.DATABASE_ERROR,
			);
		}
	}

	private static readonly QUERIES = {
		CREATE_INTERVIEWS_TABLE: `
      CREATE TABLE IF NOT EXISTS interviews (
        interviewId TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        skills TEXT NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `,
		CREATE_MESSAGES_TABLE: `
      CREATE TABLE IF NOT EXISTS messages (
        messageId TEXT PRIMARY KEY,
        interviewId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (interviewId) REFERENCES interviews(interviewId)
      )
    `,
		CREATE_MESSAGE_INDEX: `
      CREATE INDEX IF NOT EXISTS idx_messages_interview ON messages(interviewId)
    `,
	};
}
```

Update the `Interview` Durable Object to use the database service by modifying `src/interview.ts`:

```typescript title="src/interview.ts"
import { InterviewDatabaseService } from "./services/InterviewDatabaseService";

export class Interview extends DurableObject<CloudflareBindings> {
	// Database service for persistent storage of interview data and messages
	private readonly db: InterviewDatabaseService;
	private sessions: Map<WebSocket, { interviewId: string }>;

	constructor(state: DurableObjectState, env: CloudflareBindings) {
		// ... previous code ...
		// Set up our database connection using the DO's built-in SQLite instance
		this.db = new InterviewDatabaseService(state.storage.sql);
		// First-time setup: ensure our database tables exist
		// This is idempotent so safe to call on every instantiation
		this.db.createTables();
	}
}
```

Add methods to create and retrieve interviews in `services/InterviewDatabaseService.ts`:

```typescript title="src/services/InterviewDatabaseService.ts"
export class InterviewDatabaseService {
	/**
	 * Creates a new interview session in the database.
	 *
	 * This is the main entry point for starting a new interview. It handles all the
	 * initial setup like:
	 * - Generating a unique ID using crypto.randomUUID() for reliable uniqueness
	 * - Recording the interview title and required skills
	 * - Setting up timestamps for tracking interview lifecycle
	 * - Setting the initial status to "Created"
	 *
	 */
	createInterview(title: InterviewTitle, skills: InterviewSkill[]): string {
		try {
			const interviewId = crypto.randomUUID();
			const currentTime = Date.now();

			this.sql.exec(
				InterviewDatabaseService.QUERIES.INSERT_INTERVIEW,
				interviewId,
				title,
				JSON.stringify(skills), // Store skills as JSON for flexibility
				InterviewStatus.Created,
				currentTime,
				currentTime,
			);

			return interviewId;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new InterviewError(
				`Failed to create interview: ${message}`,
				ErrorCodes.DATABASE_ERROR,
			);
		}
	}

	/**
	 * Fetches all interviews from the database, ordered by creation date.
	 *
	 * This is useful for displaying interview history and letting users
	 * resume previous sessions. We order by descending creation date since
	 * users typically want to see their most recent interviews first.
	 *
	 * Returns an array of InterviewData objects with full interview details
	 * including metadata and message history.
	 */
	getAllInterviews(): InterviewData[] {
		try {
			const cursor = this.sql.exec(
				InterviewDatabaseService.QUERIES.GET_ALL_INTERVIEWS,
			);

			return [...cursor].map(this.parseInterviewRecord);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new InterviewError(
				`Failed to retrieve interviews: ${message}`,
				ErrorCodes.DATABASE_ERROR,
			);
		}
	}

	// Retrieves an interview and its messages by ID
	getInterview(interviewId: string): InterviewData | null {
		try {
			const cursor = this.sql.exec(
				InterviewDatabaseService.QUERIES.GET_INTERVIEW,
				interviewId,
			);

			const record = [...cursor][0];
			if (!record) return null;

			return this.parseInterviewRecord(record);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new InterviewError(
				`Failed to retrieve interview: ${message}`,
				ErrorCodes.DATABASE_ERROR,
			);
		}
	}

	addMessage(
		interviewId: string,
		role: Message["role"],
		content: string,
		messageId: string,
	): Message {
		try {
			const timestamp = Date.now();

			this.sql.exec(
				InterviewDatabaseService.QUERIES.INSERT_MESSAGE,
				messageId,
				interviewId,
				role,
				content,
				timestamp,
			);

			return {
				messageId,
				interviewId,
				role,
				content,
				timestamp,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new InterviewError(
				`Failed to add message: ${message}`,
				ErrorCodes.DATABASE_ERROR,
			);
		}
	}

	/**
	 * Transforms raw database records into structured InterviewData objects.
	 *
	 * This helper does the heavy lifting of:
	 * - Type checking critical fields to catch database corruption early
	 * - Converting stored JSON strings back into proper objects
	 * - Filtering out any null messages that might have snuck in
	 * - Ensuring timestamps are proper numbers
	 *
	 * If any required data is missing or malformed, it throws an error
	 * rather than returning partially valid data that could cause issues
	 * downstream.
	 */
	private parseInterviewRecord(record: any): InterviewData {
		const interviewId = record.interviewId as string;
		const createdAt = Number(record.createdAt);
		const updatedAt = Number(record.updatedAt);

		if (!interviewId || !createdAt || !updatedAt) {
			throw new InterviewError(
				"Invalid interview data in database",
				ErrorCodes.DATABASE_ERROR,
			);
		}

		return {
			interviewId,
			title: record.title as InterviewTitle,
			skills: JSON.parse(record.skills as string) as InterviewSkill[],
			messages: record.messages
				? JSON.parse(record.messages)
						.filter((m: any) => m !== null)
						.map((m: any) => ({
							messageId: m.messageId,
							role: m.role,
							content: m.content,
							timestamp: m.timestamp,
						}))
				: [],
			status: record.status as InterviewStatus,
			createdAt,
			updatedAt,
		};
	}

	// Add these SQL queries to the QUERIES object
	private static readonly QUERIES = {
		// ... previous queries ...

		INSERT_INTERVIEW: `
      INSERT INTO ${CONFIG.database.tables.interviews}
      (interviewId, title, skills, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `,

		GET_ALL_INTERVIEWS: `
      SELECT
        interviewId,
        title,
        skills,
        createdAt,
        updatedAt,
        status
      FROM ${CONFIG.database.tables.interviews}
      ORDER BY createdAt DESC
    `,

		INSERT_MESSAGE: `
      INSERT INTO ${CONFIG.database.tables.messages}
      (messageId, interviewId, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `,

		GET_INTERVIEW: `
      SELECT
        i.interviewId,
        i.title,
        i.skills,
        i.status,
        i.createdAt,
        i.updatedAt,
        COALESCE(
          json_group_array(
            CASE WHEN m.messageId IS NOT NULL THEN
              json_object(
                'messageId', m.messageId,
                'role', m.role,
                'content', m.content,
                'timestamp', m.timestamp
              )
            END
          ),
          '[]'
        ) as messages
      FROM ${CONFIG.database.tables.interviews} i
      LEFT JOIN ${CONFIG.database.tables.messages} m ON i.interviewId = m.interviewId
      WHERE i.interviewId = ?
      GROUP BY i.interviewId
    `,
	};
}
```

Add RPC methods to the `Interview` Durable Object to expose database operations through API. Add this code to `src/interview.ts`:

```typescript title="src/interview.ts"
import {
	InterviewData,
	InterviewTitle,
	InterviewSkill,
	Message,
} from "./types";

export class Interview extends DurableObject<CloudflareBindings> {
	// Creates a new interview session
	createInterview(title: InterviewTitle, skills: InterviewSkill[]): string {
		return this.db.createInterview(title, skills);
	}

	// Retrieves all interview sessions
	getAllInterviews(): InterviewData[] {
		return this.db.getAllInterviews();
	}

	// Adds a new message to the 'messages' table and broadcasts it to all connected WebSocket clients.
	addMessage(
		interviewId: string,
		role: "user" | "assistant",
		content: string,
		messageId: string,
	): Message {
		const newMessage = this.db.addMessage(
			interviewId,
			role,
			content,
			messageId,
		);
		this.broadcast(
			JSON.stringify({
				...newMessage,
				type: "message",
			}),
		);
		return newMessage;
	}
}
```

## 6. Create REST API endpoints

With your Durable Object and database service ready, create REST API endpoints to manage interviews. You will need endpoints to:

- Create new interviews
- Retrieve all interviews for a user

Create a new file for your interview routes at `routes/interview.ts`:

```typescript title="src/routes/interview.ts"
import { Hono } from "hono";
import { BadRequestError } from "../errors";
import {
	InterviewInput,
	ApiContext,
	HonoCtx,
	InterviewTitle,
	InterviewSkill,
} from "../types";
import { requireAuth } from "../middleware/auth";

/**
 * Gets the Interview Durable Object instance for a given user.
 * We use the username as a stable identifier to ensure each user
 * gets their own dedicated DO instance that persists across requests.
 */
const getInterviewDO = (ctx: HonoCtx) => {
	const username = ctx.get("username");
	const id = ctx.env.INTERVIEW.idFromName(username);
	return ctx.env.INTERVIEW.get(id);
};

/**
 * Validates the interview creation payload.
 * Makes sure we have all required fields in the correct format:
 * - title must be present
 * - skills must be a non-empty array
 * Throws an error if validation fails.
 */
const validateInterviewInput = (input: InterviewInput) => {
	if (
		!input.title ||
		!input.skills ||
		!Array.isArray(input.skills) ||
		input.skills.length === 0
	) {
		throw new BadRequestError("Invalid input");
	}
};

/**
 * GET /interviews
 * Retrieves all interviews for the authenticated user.
 * The interviews are stored and managed by the user's DO instance.
 */
const getAllInterviews = async (ctx: HonoCtx) => {
	const interviewDO = getInterviewDO(ctx);
	const interviews = await interviewDO.getAllInterviews();
	return ctx.json(interviews);
};

/**
 * POST /interviews
 * Creates a new interview session with the specified title and skills.
 * Each interview gets a unique ID that can be used to reference it later.
 * Returns the newly created interview ID on success.
 */
const createInterview = async (ctx: HonoCtx) => {
	const body = await ctx.req.json<InterviewInput>();
	validateInterviewInput(body);

	const interviewDO = getInterviewDO(ctx);
	const interviewId = await interviewDO.createInterview(
		body.title as InterviewTitle,
		body.skills as InterviewSkill[],
	);

	return ctx.json({ success: true, interviewId });
};

/**
 * Sets up all interview-related routes.
 * Currently supports:
 * - GET / : List all interviews
 * - POST / : Create a new interview
 */
export const configureInterviewRoutes = () => {
	const router = new Hono<ApiContext>();
	router.use("*", requireAuth);
	router.get("/", getAllInterviews);
	router.post("/", createInterview);
	return router;
};
```

The `getInterviewDO` helper function uses the username from our authentication cookie to create a unique Durable Object ID. This ensures each user has their own isolated interview state.

Update your main application file to include the routes and protect them with authentication middleware. Update `src/index.ts`:

```typescript title="src/index.ts"
import { configureAuthRoutes } from "./routes/auth";
import { configureInterviewRoutes } from "./routes/interview";
import { Hono } from "hono";
import { Interview } from "./interview";
import { logger } from "hono/logger";
import type { ApiContext } from "./types";

const app = new Hono<ApiContext>();
const api = new Hono<ApiContext>();

app.use("*", logger());

api.route("/auth", configureAuthRoutes());
api.route("/interviews", configureInterviewRoutes());

app.route("/api/v1", api);

export { Interview };
export default app;
```

Now you have two new API endpoints:

- `POST /api/v1/interviews`: Creates a new interview session
- `GET /api/v1/interviews`: Retrieves all interviews for the authenticated user

You can test these endpoints running the following command:

1. Create a new interview:

```sh
curl -X POST http://localhost:8787/api/v1/interviews \
-H "Content-Type: application/json" \
-H "Cookie: username=testuser; HttpOnly" \
-d '{"title":"Frontend Developer Interview","skills":["JavaScript","React","CSS"]}'
```

2. Get all interviews:

```sh
curl http://localhost:8787/api/v1/interviews \
-H "Cookie: username=testuser; HttpOnly"
```

## 7. Set up WebSockets to handle real-time communication

With the basic interview management system in place, you will now implement Durable Objects to handle real-time message processing and maintain WebSocket connections.

Update the `Interview` Durable Object to handle WebSocket connections by adding the following code to `src/interview.ts`:

```typescript
export class Interview extends DurableObject<CloudflareBindings> {
	// Services for database operations and managing WebSocket sessions
	private readonly db: InterviewDatabaseService;
	private sessions: Map<WebSocket, { interviewId: string }>;

	constructor(state: DurableObjectState, env: CloudflareBindings) {
		// ... previous code ...

		// Keep WebSocket connections alive by automatically responding to pings
		// This prevents timeouts and connection drops
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
	}

	async fetch(request: Request): Promise<Response> {
		// Check if this is a WebSocket upgrade request
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader?.toLowerCase().includes("websocket")) {
			return this.handleWebSocketUpgrade(request);
		}

		// If it is not a WebSocket request, we don't handle it
		return new Response("Not found", { status: 404 });
	}

	private async handleWebSocketUpgrade(request: Request): Promise<Response> {
		// Extract the interview ID from the URL - it should be the last segment
		const url = new URL(request.url);
		const interviewId = url.pathname.split("/").pop();

		if (!interviewId) {
			return new Response("Missing interviewId parameter", { status: 400 });
		}

		// Create a new WebSocket connection pair - one for the client, one for the server
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// Keep track of which interview this WebSocket is connected to
		// This is important for routing messages to the right interview session
		this.sessions.set(server, { interviewId });

		// Tell the Durable Object to start handling this WebSocket
		this.ctx.acceptWebSocket(server);

		// Send the current interview state to the client right away
		// This helps initialize their UI with the latest data
		const interviewData = await this.db.getInterview(interviewId);
		if (interviewData) {
			server.send(
				JSON.stringify({
					type: "interview_details",
					data: interviewData,
				}),
			);
		}

		// Return the client WebSocket as part of the upgrade response
		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean,
	) {
		// Clean up when a connection closes to prevent memory leaks
		// This is especially important in long-running Durable Objects
		console.log(
			`WebSocket closed: Code ${code}, Reason: ${reason}, Clean: ${wasClean}`,
		);
	}
}
```

Next, update the interview routes to include a WebSocket endpoint. Add the following to `routes/interview.ts`:

```typescript title="src/routes/interview.ts"
// ... previous code ...
const streamInterviewProcess = async (ctx: HonoCtx) => {
	const interviewDO = getInterviewDO(ctx);
	return await interviewDO.fetch(ctx.req.raw);
};

export const configureInterviewRoutes = () => {
	const router = new Hono<ApiContext>();
	router.get("/", getAllInterviews);
	router.post("/", createInterview);
	// Add WebSocket route
	router.get("/:interviewId", streamInterviewProcess);
	return router;
};
```

The WebSocket system provides real-time communication features for interview practice tool:

- Each interview session gets its own dedicated WebSocket connection, allowing seamless communication between the candidate and AI interviewer
- The Durable Object maintains the connection state, ensuring no messages are lost even if the client temporarily disconnects
- To keep connections stable, it automatically responds to ping messages with pongs, preventing timeouts
- Candidates and interviewers receive instant updates as the interview progresses, creating a natural conversational flow

## 8. Add audio processing capabilities with Workers AI

Now that WebSocket connection set up, the next step is to add speech-to-text capabilities using Workers AI. Let's use Cloudflare's Whisper model to transcribe audio in real-time during the interview.

The audio processing pipeline will work like this:

1. Client sends audio through the WebSocket connection
2. Our Durable Object receives the binary audio data
3. We pass the audio to Whisper for transcription
4. The transcribed text is saved as a new message
5. We immediately send the transcription back to the client
6. The client receives a notification that the AI interviewer is generating a response

### Create audio processing pipeline

In this step you will update the Interview Durable Object to handle the following:

1. Detect binary audio data sent through WebSocket
2. Create a unique message ID for tracking the processing status
3. Notify clients that audio processing has begun
4. Include error handling for failed audio processing
5. Broadcast status updates to all connected clients

First, update Interview Durable Object to handle binary WebSocket messages. Add the following methods to your `src/interview.ts` file:

```typescript title="src/interview.ts"
// ... previous code ...
/**
 * Handles incoming WebSocket messages, both binary audio data and text messages.
 * This is the main entry point for all WebSocket communication.
 */
async webSocketMessage(ws: WebSocket, eventData: ArrayBuffer | string): Promise<void> {
  try {
    // Handle binary audio data from the client's microphone
    if (eventData instanceof ArrayBuffer) {
      await this.handleBinaryAudio(ws, eventData);
      return;
    }
    // Text messages will be handled by other methods
  } catch (error) {
    this.handleWebSocketError(ws, error);
  }
}

/**
 * Processes binary audio data received from the client.
 * Converts audio to text using Whisper and broadcasts processing status.
 */
private async handleBinaryAudio(ws: WebSocket, audioData: ArrayBuffer): Promise<void> {
  try {
    const uint8Array = new Uint8Array(audioData);

    // Retrieve the associated interview session
    const session = this.sessions.get(ws);
    if (!session?.interviewId) {
      throw new Error("No interview session found");
    }

    // Generate unique ID to track this message through the system
    const messageId = crypto.randomUUID();

    // Let the client know we're processing their audio
    this.broadcast(
      JSON.stringify({
        type: "message",
        status: "processing",
        role: "user",
        messageId,
        interviewId: session.interviewId,
      }),
    );

    // TODO: Implement Whisper transcription in next section
    // For now, just log the received audio data size
    console.log(`Received audio data of length: ${uint8Array.length}`);
  } catch (error) {
    console.error("Audio processing failed:", error);
    this.handleWebSocketError(ws, error);
  }
}

/**
 * Handles WebSocket errors by logging them and notifying the client.
 * Ensures errors are properly communicated back to the user.
 */
private handleWebSocketError(ws: WebSocket, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
  console.error("WebSocket error:", errorMessage);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: errorMessage,
      }),
    );
  }
}

```

Your `handleBinaryAudio` method currently logs when it receives audio data. Next, you'll enhance it to transcribe speech using Workers AI's Whisper model.

### Configure speech-to-text

Now that audio processing pipeline is set up, you will now integrate Workers AI's Whisper model for speech-to-text transcription.

Configure the Worker AI binding in your Wrangler file by adding:

```toml
# ... previous configuration ...
[ai]
binding = "AI"
```

Next, generate TypeScript types for our AI binding. Run the following command:

```sh
npm run cf-typegen
```

You will need a new service class for AI operations. Create a new file called `services/AIService.ts`:

```typescript title="src/services/AIService.ts"
import { InterviewError, ErrorCodes } from "../errors";

export class AIService {
	constructor(private readonly AI: Ai) {}

	async transcribeAudio(audioData: Uint8Array): Promise<string> {
		try {
			// Call the Whisper model to transcribe the audio
			const response = await this.AI.run("@cf/openai/whisper-tiny-en", {
				audio: Array.from(audioData),
			});

			if (!response?.text) {
				throw new Error("Failed to transcribe audio content.");
			}

			return response.text;
		} catch (error) {
			throw new InterviewError(
				"Failed to transcribe audio content",
				ErrorCodes.TRANSCRIPTION_FAILED,
			);
		}
	}
}
```

You will need to update the `Interview` Durable Object to use this new AI service. To do this, update the handleBinaryAudio method in `src/interview.ts`:

```typescript title="src/interview.ts"
import { AIService } from "./services/AIService";

export class Interview extends DurableObject<CloudflareBindings> {
private readonly aiService: AIService;

constructor(state: DurableObjectState, env: Env) {
  // ... previous code ...

  // Initialize the AI service with the Workers AI binding
  this.aiService = new AIService(this.env.AI);
}

private async handleBinaryAudio(ws: WebSocket, audioData: ArrayBuffer): Promise<void> {
  try {
    const uint8Array = new Uint8Array(audioData);
    const session = this.sessions.get(ws);

    if (!session?.interviewId) {
      throw new Error("No interview session found");
    }

    // Create a message ID for tracking
    const messageId = crypto.randomUUID();

    // Send processing state to client
    this.broadcast(
      JSON.stringify({
        type: "message",
        status: "processing",
        role: "user",
        messageId,
        interviewId: session.interviewId,
      }),
    );

    // NEW: Use AI service to transcribe the audio
    const transcribedText = await this.aiService.transcribeAudio(uint8Array);

    // Store the transcribed message
    await this.addMessage(session.interviewId, "user", transcribedText, messageId);

  } catch (error) {
    console.error("Audio processing failed:", error);
    this.handleWebSocketError(ws, error);
  }
}
```

:::note
The Whisper model `@cf/openai/whisper-tiny-en` is optimized for English speech recognition. If you need support for other languages, you can use different Whisper model variants available through Workers AI.
:::

When users speak during the interview, their audio will be automatically transcribed and stored as messages in the interview session. The transcribed text will be immediately available to both the user and the AI interviewer for generating appropriate responses.

## 9. Integrate AI response generation

Now that you have audio transcription working, let's implement AI interviewer response generation using Workers AI's LLM capabilities. You'll create an interview system that:

- Maintains context of the conversation
- Provides relevant follow-up questions
- Gives constructive feedback
- Stays in character as a professional interviewer

### Set up Workers AI LLM integration

First, update the `AIService` class to handle LLM interactions. You will need to add methods for:

- Processing interview context
- Generating appropriate responses
- Handling conversation flow

Update the `services/AIService.ts` class to include LLM functionality:

```typescript title="src/services/AIService.ts"
import { InterviewData, Message } from "../types";

export class AIService {

async processLLMResponse(interview: InterviewData): Promise<string> {
  const messages = this.prepareLLMMessages(interview);

  try {
    const { response } = await this.AI.run("@cf/meta/llama-2-7b-chat-int8", {
      messages,
    });

    if (!response) {
      throw new Error("Failed to generate a response from the LLM model.");
    }

    return response;
  } catch (error) {
    throw new InterviewError("Failed to generate a response from the LLM model.", ErrorCodes.LLM_FAILED);
  }
}

private prepareLLMMessages(interview: InterviewData) {
  const messageHistory = interview.messages.map((msg: Message) => ({
    role: msg.role,
    content: msg.content,
  }));

  return [
    {
      role: "system",
      content: this.createSystemPrompt(interview),
    },
    ...messageHistory,
  ];
}
```

:::note
The @cf/meta/llama-2-7b-chat-int8 model is optimized for chat-like interactions and provides good performance while maintaining reasonable resource usage.
:::

### Create the conversation prompt

Prompt engineering is crucial for getting high-quality responses from the LLM. Next, you will create a system prompt that:

- Sets the context for the interview
- Defines the interviewer's role and behavior
- Specifies the technical focus areas
- Guides the conversation flow

Add the following method to your `services/AIService.ts` class:

```typescript title="src/services/AIService.ts"
private createSystemPrompt(interview: InterviewData): string {
  const basePrompt = "You are conducting a technical interview.";
  const rolePrompt = `The position is for ${interview.title}.`;
  const skillsPrompt = `Focus on topics related to: ${interview.skills.join(", ")}.`;
  const instructionsPrompt = "Ask relevant technical questions and provide constructive feedback.";

  return `${basePrompt} ${rolePrompt} ${skillsPrompt} ${instructionsPrompt}`;
}
```

### Implement response generation logic

Finally, integrate the LLM response generation into the interview flow. Update the `handleBinaryAudio` method in the `src/interview.ts` Durable Object to:

- Process transcribed user responses
- Generate appropriate AI interviewer responses
- Maintain conversation context

Update the `handleBinaryAudio` method in `src/interview.ts`:

```typescript title="src/interview.ts"
private async handleBinaryAudio(ws: WebSocket, audioData: ArrayBuffer): Promise<void> {
  try {
    // Convert raw audio buffer to uint8 array for processing
    const uint8Array = new Uint8Array(audioData);
    const session = this.sessions.get(ws);

    if (!session?.interviewId) {
      throw new Error("No interview session found");
    }

    // Generate a unique ID to track this message through the system
    const messageId = crypto.randomUUID();

    // Let the client know we're processing their audio
    // This helps provide immediate feedback while transcription runs
    this.broadcast(
      JSON.stringify({
        type: "message",
        status: "processing",
        role: "user",
        messageId,
        interviewId: session.interviewId,
      }),
    );

    // Convert the audio to text using our AI transcription service
    // This typically takes 1-2 seconds for normal speech
    const transcribedText = await this.aiService.transcribeAudio(uint8Array);

    // Save the user's message to our database so we maintain chat history
    await this.addMessage(session.interviewId, "user", transcribedText, messageId);

    // Look up the full interview context - we need this to generate a good response
    const interview = await this.db.getInterview(session.interviewId);
    if (!interview) {
      throw new Error(`Interview not found: ${session.interviewId}`);
    }

    // Now it's the AI's turn to respond
    // First generate an ID for the assistant's message
    const assistantMessageId = crypto.randomUUID();

    // Let the client know we're working on the AI response
    this.broadcast(
      JSON.stringify({
        type: "message",
        status: "processing",
        role: "assistant",
        messageId: assistantMessageId,
        interviewId: session.interviewId,
      }),
    );

    // Generate the AI interviewer's response based on the conversation history
    const llmResponse = await this.aiService.processLLMResponse(interview);
    await this.addMessage(session.interviewId, "assistant", llmResponse, assistantMessageId);
  } catch (error) {
    // Something went wrong processing the audio or generating a response
    // Log it and let the client know there was an error
    console.error("Audio processing failed:", error);
    this.handleWebSocketError(ws, error);
  }
}
```

## Conclusion

You have successfully built an AI-powered interview practice tool using Cloudflare's Workers AI. In summary, you have:

- Created a real-time WebSocket communication system using Durable Objects
- Implemented speech-to-text processing with Workers AI Whisper model
- Built an intelligent interview system using Workers AI LLM capabilities
- Designed a persistent storage system with SQLite in Durable Objects

The complete source code for this tutorial is available on GitHub:
[ai-interview-practice-tool](https://github.com/berezovyy/ai-interview-practice-tool)

---

# Explore Code Generation Using DeepSeek Coder Models

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/explore-code-generation-using-deepseek-coder-models/

import { Stream } from "~/components"

A handy way to explore all of the models available on [Workers AI](/workers-ai) is to use a [Jupyter Notebook](https://jupyter.org/).

You can [download the DeepSeek Coder notebook](/workers-ai/static/documentation/notebooks/deepseek-coder-exploration.ipynb) or view the embedded notebook below.

<Stream id="97b46763341a395a4ce1c0a6f913662b" title="Explore Code Generation Using DeepSeek Coder Models" />

[comment]: <> "The markdown below is auto-generated from https://github.com/craigsdennis/notebooks-cloudflare-workers-ai"

***

## Exploring Code Generation Using DeepSeek Coder

AI Models being able to generate code unlocks all sorts of use cases. The [DeepSeek Coder](https://github.com/deepseek-ai/DeepSeek-Coder) models `@hf/thebloke/deepseek-coder-6.7b-base-awq` and `@hf/thebloke/deepseek-coder-6.7b-instruct-awq` are now available on [Workers AI](/workers-ai).

Let's explore them using the API!

```python
import sys
!{sys.executable} -m pip install requests python-dotenv
```

```
Requirement already satisfied: requests in ./venv/lib/python3.12/site-packages (2.31.0)
Requirement already satisfied: python-dotenv in ./venv/lib/python3.12/site-packages (1.0.1)
Requirement already satisfied: charset-normalizer<4,>=2 in ./venv/lib/python3.12/site-packages (from requests) (3.3.2)
Requirement already satisfied: idna<4,>=2.5 in ./venv/lib/python3.12/site-packages (from requests) (3.6)
Requirement already satisfied: urllib3<3,>=1.21.1 in ./venv/lib/python3.12/site-packages (from requests) (2.1.0)
Requirement already satisfied: certifi>=2017.4.17 in ./venv/lib/python3.12/site-packages (from requests) (2023.11.17)
```

```python
import os
from getpass import getpass

from IPython.display import display, Image, Markdown, Audio

import requests
```

```python
%load_ext dotenv
%dotenv
```

### Configuring your environment

To use the API you'll need your [Cloudflare Account ID](https://dash.cloudflare.com) (head to Workers & Pages > Overview > Account details > Account ID) and a [Workers AI enabled API Token](https://dash.cloudflare.com/profile/api-tokens).

If you want to add these files to your environment, you can create a new file named `.env`

```bash
CLOUDFLARE_API_TOKEN="YOUR-TOKEN"
CLOUDFLARE_ACCOUNT_ID="YOUR-ACCOUNT-ID"
```

```python
if "CLOUDFLARE_API_TOKEN" in os.environ:
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
else:
    api_token = getpass("Enter you Cloudflare API Token")
```

```python
if "CLOUDFLARE_ACCOUNT_ID" in os.environ:
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
else:
    account_id = getpass("Enter your account id")
```

### Generate code from a comment

A common use case is to complete the code for the user after they provide a descriptive comment.

````python
model = "@hf/thebloke/deepseek-coder-6.7b-base-awq"

prompt = "# A function that checks if a given word is a palindrome"

response = requests.post(
    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
    headers={"Authorization": f"Bearer {api_token}"},
    json={"messages": [
        {"role": "user", "content": prompt}
    ]}
)
inference = response.json()
code = inference["result"]["response"]

display(Markdown(f"""
    ```python
    {prompt}
    {code.strip()}
    ```
"""))
````

```python
# A function that checks if a given word is a palindrome
def is_palindrome(word):
    # Convert the word to lowercase
    word = word.lower()

    # Reverse the word
    reversed_word = word[::-1]

    # Check if the reversed word is the same as the original word
    if word == reversed_word:
        return True
    else:
        return False

# Test the function
print(is_palindrome("racecar"))  # Output: True
print(is_palindrome("hello"))    # Output: False
```

### Assist in debugging

We've all been there, bugs happen. Sometimes those stacktraces can be very intimidating, and a great use case of using Code Generation is to assist in explaining the problem.

```python
model = "@hf/thebloke/deepseek-coder-6.7b-instruct-awq"

system_message = "The user is going to give you code that isn't working. Explain to the user what might be wrong"

code = """# Welcomes our user
def hello_world(first_name="World"):
    print(f"Hello, {name}!")
"""

response = requests.post(
    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
    headers={"Authorization": f"Bearer {api_token}"},
    json={"messages": [
        {"role": "system", "content": system_message},
        {"role": "user", "content": code},
    ]}
)
inference = response.json()
response = inference["result"]["response"]
display(Markdown(response))
```

The error in your code is that you are trying to use a variable `name` which is not defined anywhere in your function. The correct variable to use is `first_name`. So, you should change `f"Hello, {name}!"` to `f"Hello, {first_name}!"`.

Here is the corrected code:

```python
# Welcomes our user
def hello_world(first_name="World"):
    print(f"Hello, {first_name}")
```

Now, when you call `hello_world()`, it will print "Hello, World" by default. If you call `hello_world("John")`, it will print "Hello, John".

### Write tests!

Writing unit tests is a common best practice. With the enough context, it's possible to write unit tests.

```python
model = "@hf/thebloke/deepseek-coder-6.7b-instruct-awq"

system_message = "The user is going to give you code and would like to have tests written in the Python unittest module."

code = """
class User:

    def __init__(self, first_name, last_name=None):
        self.first_name = first_name
        self.last_name = last_name
        if last_name is None:
            self.last_name = "Mc" + self.first_name

    def full_name(self):
        return self.first_name + " " + self.last_name
"""

response = requests.post(
    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
    headers={"Authorization": f"Bearer {api_token}"},
    json={"messages": [
        {"role": "system", "content": system_message},
        {"role": "user", "content": code},
    ]}
)
inference = response.json()
response = inference["result"]["response"]
display(Markdown(response))
```

Here is a simple unittest test case for the User class:

```python
import unittest

class TestUser(unittest.TestCase):

    def test_full_name(self):
        user = User("John", "Doe")
        self.assertEqual(user.full_name(), "John Doe")

    def test_default_last_name(self):
        user = User("Jane")
        self.assertEqual(user.full_name(), "Jane McJane")

if __name__ == '__main__':
    unittest.main()
```

In this test case, we have two tests:

* `test_full_name` tests the `full_name` method when the user has both a first name and a last name.
* `test_default_last_name` tests the `full_name` method when the user only has a first name and the last name is set to "Mc" + first name.

If all these tests pass, it means that the `full_name` method is working as expected. If any of these tests fail, it

### Fill-in-the-middle Code Completion

A common use case in Developer Tools is to autocomplete based on context. DeepSeek Coder provides the ability to submit existing code with a placeholder, so that the model can complete in context.

Warning: The tokens are prefixed with `<锝渀 and suffixed with `锝�>` make sure to copy and paste them.

````python
model = "@hf/thebloke/deepseek-coder-6.7b-base-awq"

code = """
<锝渇im鈻乥egin锝�>import re

from jklol import email_service

def send_email(email_address, body):
    <锝渇im鈻乭ole锝�>
    if not is_valid_email:
        raise InvalidEmailAddress(email_address)
    return email_service.send(email_address, body)<锝渇im鈻乪nd锝�>
"""

response = requests.post(
    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
    headers={"Authorization": f"Bearer {api_token}"},
    json={"messages": [
        {"role": "user", "content": code}
    ]}
)
inference = response.json()
response = inference["result"]["response"]
display(Markdown(f"""
    ```python
    {response.strip()}
    ```
"""))

````

```python
is_valid_email = re.match(r"[^@]+@[^@]+\.[^@]+", email_address)
```

### Experimental: Extract data into JSON

No need to threaten the model or bring grandma into the prompt. Get back JSON in the format you want.

````python
model = "@hf/thebloke/deepseek-coder-6.7b-instruct-awq"

# Learn more at https://json-schema.org/
json_schema = """
{
  "title": "User",
  "description": "A user from our example app",
  "type": "object",
  "properties": {
    "firstName": {
      "description": "The user's first name",
      "type": "string"
    },
    "lastName": {
      "description": "The user's last name",
      "type": "string"
    },
    "numKids": {
      "description": "Amount of children the user has currently",
      "type": "integer"
    },
    "interests": {
      "description": "A list of what the user has shown interest in",
      "type": "array",
      "items": {
        "type": "string"
      }
    },
  },
  "required": [ "firstName" ]
}
"""

system_prompt = f"""
The user is going to discuss themselves and you should create a JSON object from their description to match the json schema below.

<BEGIN JSON SCHEMA>
{json_schema}
<END JSON SCHEMA>

Return JSON only. Do not explain or provide usage examples.
"""

prompt = """Hey there, I'm Craig Dennis and I'm a Developer Educator at Cloudflare. My email is craig@cloudflare.com.
            I am very interested in AI. I've got two kids. I love tacos, burritos, and all things Cloudflare"""

response = requests.post(
    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
    headers={"Authorization": f"Bearer {api_token}"},
    json={"messages": [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt}
    ]}
)
inference = response.json()
response = inference["result"]["response"]
display(Markdown(f"""
    ```json
    {response.strip()}
    ```
"""))
````

```json
{
  "firstName": "Craig",
  "lastName": "Dennis",
  "numKids": 2,
  "interests": ["AI", "Cloudflare", "Tacos", "Burritos"]
}
```

---

# Explore Workers AI Models Using a Jupyter Notebook

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/explore-workers-ai-models-using-a-jupyter-notebook/

import { Stream } from "~/components"

A handy way to explore all of the models available on [Workers AI](/workers-ai) is to use a [Jupyter Notebook](https://jupyter.org/).

You can [download the Workers AI notebook](/workers-ai-notebooks/cloudflare-workers-ai.ipynb) or view the embedded notebook below.

Or you can run this on [Google Colab](https://colab.research.google.com/github/craigsdennis/notebooks-cloudflare-workers-ai/blob/main/cloudflare-workers-ai.ipynb)

<Stream id="2c60022bea5c8c1b343e76566fed76f2" title="Explore Workers AI Models Using a Jupyter Notebook" thumbnail="2.5s" />

[comment]: <> "The markdown below is auto-generated from https://github.com/craigsdennis/notebooks-cloudflare-workers-ai the <audio> tag is hard coded"

***

## Explore the Workers AI API using Python

[Workers AI](/workers-ai) allows you to run machine learning models, on the Cloudflare network, from your own code 鈥� whether that be from Workers, Pages, or anywhere via REST API.

This notebook will explore the Workers AI REST API using the [official Python SDK](https://github.com/cloudflare/cloudflare-python).


```python
import os
from getpass import getpass

from cloudflare import Cloudflare
from IPython.display import display, Image, Markdown, Audio
import requests
```


```python
%load_ext dotenv
%dotenv
```


### Configuring your environment

To use the API you'll need your [Cloudflare Account ID](https://dash.cloudflare.com). Head to AI > Workers AI page and press the "Use REST API". This page will let you create a new API Token and copy your Account ID.

If you want to add these values to your environment variables, you can **create a new file** named `.env` and this notebook will read those values.

```bash
CLOUDFLARE_API_TOKEN="YOUR-TOKEN"
CLOUDFLARE_ACCOUNT_ID="YOUR-ACCOUNT-ID"
```

Otherwise you can just enter the values securely when prompted below.


```python
if "CLOUDFLARE_API_TOKEN" in os.environ:
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
else:
    api_token = getpass("Enter you Cloudflare API Token")
```


```python
if "CLOUDFLARE_ACCOUNT_ID" in os.environ:
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
else:
    account_id = getpass("Enter your account id")
```


```python
# Initialize client
client = Cloudflare(api_token=api_token)
```

## Explore tasks available on the Workers AI Platform

### Text Generation

Explore all [Text Generation Models](/workers-ai/models)


```python
result = client.workers.ai.run(
    "@cf/meta/llama-3-8b-instruct" ,
    account_id=account_id,
    messages=[
        {"role": "system", "content": """
            You are a productivity assistant for users of Jupyter notebooks for both Mac and Windows users.

            Respond in Markdown."""
        },
        {"role": "user", "content": "How do I use keyboard shortcuts to execute cells?"}
    ]
)

display(Markdown(result["response"]))
```


**Using Keyboard Shortcuts to Execute Cells in Jupyter Notebooks**
===============================================================

Executing cells in Jupyter Notebooks can be done quickly and efficiently using various keyboard shortcuts, saving you time and effort. Here are the shortcuts you can use:

**Mac**

* **Shift + Enter**: Execute the current cell and insert a new cell below.
* **Ctrl + Enter**: Execute the current cell and insert a new cell below, without creating a new output display.

**Windows/Linux**

* **Shift + Enter**: Execute the current cell and insert a new cell below.
* **Ctrl + Enter**: Execute the current cell and move to the next cell.

**Additional Shortcuts**

* **Alt + Enter**: Execute the current cell and create a new output display below (Mac), or move to the next cell (Windows/Linux).
* **Ctrl + Shift + Enter**: Execute the current cell and create a new output display below (Mac), or create a new cell below (Windows/Linux).

**Tips and Tricks**

* You can also use the **Run Cell** button in the Jupyter Notebook toolbar, or the **Run** menu option (macOS) or **Run -> Run Cell** (Windows/Linux).
* To execute a selection of cells, use **Shift + Alt + Enter** (Mac) or **Shift + Ctrl + Enter** (Windows/Linux).
* To execute a cell and move to the next cell, use **Ctrl + Shift + Enter** (all platforms).

By using these keyboard shortcuts, you'll be able to work more efficiently and quickly in your Jupyter Notebooks. Happy coding!


### Text to Image

Explore all [Text to Image models](/workers-ai/models)


```python
data = client.workers.ai.with_raw_response.run(
    "@cf/lykon/dreamshaper-8-lcm",
    account_id=account_id,
    prompt="A software developer incredibly excited about AI, huge smile",
)

display(Image(data.read()))
```



![png](/workers-ai-notebooks/cloudflare-workers-ai/assets/output_13_0.png)


### Image to Text

Explore all [Image to Text](/workers-ai/models/) models


```python
url = "https://blog.cloudflare.com/content/images/2017/11/lava-lamps.jpg"

image_request = requests.get(url, allow_redirects=True)

display(Image(image_request.content, format="jpg"))

data = client.workers.ai.run(
    "@cf/llava-hf/llava-1.5-7b-hf",
    account_id=account_id,
    image=image_request.content,
    prompt="Describe this photo",
    max_tokens=2048
)

print(data["description"])
```



![lava lamps](https://blog.cloudflare.com/content/images/2017/11/lava-lamps.jpg)



     The image features a display of various colored lava lamps. There are at least 14 lava lamps in the scene, each with a different color and design. The lamps are arranged in a visually appealing manner, with some placed closer to the foreground and others further back. The display creates an eye-catching and vibrant atmosphere, showcasing the diverse range of lava lamps available.


### Automatic Speech Recognition

Explore all [Speech Recognition models](/workers-ai/models)


```python
url = "https://raw.githubusercontent.com/craigsdennis/notebooks-cloudflare-workers-ai/main/assets/craig-rambling.mp3"
display(Audio(url))
audio = requests.get(url)

response = client.workers.ai.run(
    "@cf/openai/whisper",
    account_id=account_id,
    audio=audio.content
)

response
```



<audio  controls="controls" >
    <source src="https://raw.githubusercontent.com/craigsdennis/notebooks-cloudflare-workers-ai/main/assets/craig-rambling.mp3" />
    Your browser does not support the audio element.
</audio>





```javascript
    {'text': "Hello there, I'm making a recording for a Jupiter notebook. That's a Python notebook, Jupiter, J-U-P-Y-T-E-R. Not to be confused with the planet. Anyways, let me hear, I'm gonna talk a little bit, I'm gonna make a little bit of noise, say some hard words, I'm gonna say Kubernetes, I'm not actually even talking about Kubernetes, I just wanna see if I can do Kubernetes. Anyway, this is a test of transcription and let's see how we're dead.",
     'word_count': 84,
     'vtt': "WEBVTT\n\n00.280 --> 01.840\nHello there, I'm making a\n\n01.840 --> 04.060\nrecording for a Jupiter notebook.\n\n04.060 --> 06.440\nThat's a Python notebook, Jupiter,\n\n06.440 --> 07.720\nJ -U -P -Y -T\n\n07.720 --> 09.420\n-E -R. Not to be\n\n09.420 --> 12.140\nconfused with the planet. Anyways,\n\n12.140 --> 12.940\nlet me hear, I'm gonna\n\n12.940 --> 13.660\ntalk a little bit, I'm\n\n13.660 --> 14.600\ngonna make a little bit\n\n14.600 --> 16.180\nof noise, say some hard\n\n16.180 --> 17.540\nwords, I'm gonna say Kubernetes,\n\n17.540 --> 18.420\nI'm not actually even talking\n\n18.420 --> 19.500\nabout Kubernetes, I just wanna\n\n19.500 --> 20.300\nsee if I can do\n\n20.300 --> 22.120\nKubernetes. Anyway, this is a\n\n22.120 --> 24.080\ntest of transcription and let's\n\n24.080 --> 26.280\nsee how we're dead.",
     'words': [{'word': 'Hello',
       'start': 0.2800000011920929,
       'end': 0.7400000095367432},
      {'word': 'there,', 'start': 0.7400000095367432, 'end': 1.2400000095367432},
      {'word': "I'm", 'start': 1.2400000095367432, 'end': 1.4800000190734863},
      {'word': 'making', 'start': 1.4800000190734863, 'end': 1.6799999475479126},
      {'word': 'a', 'start': 1.6799999475479126, 'end': 1.840000033378601},
      {'word': 'recording', 'start': 1.840000033378601, 'end': 2.2799999713897705},
      {'word': 'for', 'start': 2.2799999713897705, 'end': 2.6600000858306885},
      {'word': 'a', 'start': 2.6600000858306885, 'end': 2.799999952316284},
      {'word': 'Jupiter', 'start': 2.799999952316284, 'end': 3.2200000286102295},
      {'word': 'notebook.', 'start': 3.2200000286102295, 'end': 4.059999942779541},
      {'word': "That's", 'start': 4.059999942779541, 'end': 4.28000020980835},
      {'word': 'a', 'start': 4.28000020980835, 'end': 4.380000114440918},
      {'word': 'Python', 'start': 4.380000114440918, 'end': 4.679999828338623},
      {'word': 'notebook,', 'start': 4.679999828338623, 'end': 5.460000038146973},
      {'word': 'Jupiter,', 'start': 5.460000038146973, 'end': 6.440000057220459},
      {'word': 'J', 'start': 6.440000057220459, 'end': 6.579999923706055},
      {'word': '-U', 'start': 6.579999923706055, 'end': 6.920000076293945},
      {'word': '-P', 'start': 6.920000076293945, 'end': 7.139999866485596},
      {'word': '-Y', 'start': 7.139999866485596, 'end': 7.440000057220459},
      {'word': '-T', 'start': 7.440000057220459, 'end': 7.71999979019165},
      {'word': '-E', 'start': 7.71999979019165, 'end': 7.920000076293945},
      {'word': '-R.', 'start': 7.920000076293945, 'end': 8.539999961853027},
      {'word': 'Not', 'start': 8.539999961853027, 'end': 8.880000114440918},
      {'word': 'to', 'start': 8.880000114440918, 'end': 9.300000190734863},
      {'word': 'be', 'start': 9.300000190734863, 'end': 9.420000076293945},
      {'word': 'confused', 'start': 9.420000076293945, 'end': 9.739999771118164},
      {'word': 'with', 'start': 9.739999771118164, 'end': 9.9399995803833},
      {'word': 'the', 'start': 9.9399995803833, 'end': 10.039999961853027},
      {'word': 'planet.', 'start': 10.039999961853027, 'end': 11.380000114440918},
      {'word': 'Anyways,', 'start': 11.380000114440918, 'end': 12.140000343322754},
      {'word': 'let', 'start': 12.140000343322754, 'end': 12.420000076293945},
      {'word': 'me', 'start': 12.420000076293945, 'end': 12.520000457763672},
      {'word': 'hear,', 'start': 12.520000457763672, 'end': 12.800000190734863},
      {'word': "I'm", 'start': 12.800000190734863, 'end': 12.880000114440918},
      {'word': 'gonna', 'start': 12.880000114440918, 'end': 12.9399995803833},
      {'word': 'talk', 'start': 12.9399995803833, 'end': 13.100000381469727},
      {'word': 'a', 'start': 13.100000381469727, 'end': 13.260000228881836},
      {'word': 'little', 'start': 13.260000228881836, 'end': 13.380000114440918},
      {'word': 'bit,', 'start': 13.380000114440918, 'end': 13.5600004196167},
      {'word': "I'm", 'start': 13.5600004196167, 'end': 13.65999984741211},
      {'word': 'gonna', 'start': 13.65999984741211, 'end': 13.739999771118164},
      {'word': 'make', 'start': 13.739999771118164, 'end': 13.920000076293945},
      {'word': 'a', 'start': 13.920000076293945, 'end': 14.199999809265137},
      {'word': 'little', 'start': 14.199999809265137, 'end': 14.4399995803833},
      {'word': 'bit', 'start': 14.4399995803833, 'end': 14.600000381469727},
      {'word': 'of', 'start': 14.600000381469727, 'end': 14.699999809265137},
      {'word': 'noise,', 'start': 14.699999809265137, 'end': 15.460000038146973},
      {'word': 'say', 'start': 15.460000038146973, 'end': 15.859999656677246},
      {'word': 'some', 'start': 15.859999656677246, 'end': 16},
      {'word': 'hard', 'start': 16, 'end': 16.18000030517578},
      {'word': 'words,', 'start': 16.18000030517578, 'end': 16.540000915527344},
      {'word': "I'm", 'start': 16.540000915527344, 'end': 16.639999389648438},
      {'word': 'gonna', 'start': 16.639999389648438, 'end': 16.719999313354492},
      {'word': 'say', 'start': 16.719999313354492, 'end': 16.920000076293945},
      {'word': 'Kubernetes,',
       'start': 16.920000076293945,
       'end': 17.540000915527344},
      {'word': "I'm", 'start': 17.540000915527344, 'end': 17.65999984741211},
      {'word': 'not', 'start': 17.65999984741211, 'end': 17.719999313354492},
      {'word': 'actually', 'start': 17.719999313354492, 'end': 18},
      {'word': 'even', 'start': 18, 'end': 18.18000030517578},
      {'word': 'talking', 'start': 18.18000030517578, 'end': 18.420000076293945},
      {'word': 'about', 'start': 18.420000076293945, 'end': 18.6200008392334},
      {'word': 'Kubernetes,', 'start': 18.6200008392334, 'end': 19.1200008392334},
      {'word': 'I', 'start': 19.1200008392334, 'end': 19.239999771118164},
      {'word': 'just', 'start': 19.239999771118164, 'end': 19.360000610351562},
      {'word': 'wanna', 'start': 19.360000610351562, 'end': 19.5},
      {'word': 'see', 'start': 19.5, 'end': 19.719999313354492},
      {'word': 'if', 'start': 19.719999313354492, 'end': 19.8799991607666},
      {'word': 'I', 'start': 19.8799991607666, 'end': 19.940000534057617},
      {'word': 'can', 'start': 19.940000534057617, 'end': 20.079999923706055},
      {'word': 'do', 'start': 20.079999923706055, 'end': 20.299999237060547},
      {'word': 'Kubernetes.',
       'start': 20.299999237060547,
       'end': 21.440000534057617},
      {'word': 'Anyway,', 'start': 21.440000534057617, 'end': 21.799999237060547},
      {'word': 'this', 'start': 21.799999237060547, 'end': 21.920000076293945},
      {'word': 'is', 'start': 21.920000076293945, 'end': 22.020000457763672},
      {'word': 'a', 'start': 22.020000457763672, 'end': 22.1200008392334},
      {'word': 'test', 'start': 22.1200008392334, 'end': 22.299999237060547},
      {'word': 'of', 'start': 22.299999237060547, 'end': 22.639999389648438},
      {'word': 'transcription',
       'start': 22.639999389648438,
       'end': 23.139999389648438},
      {'word': 'and', 'start': 23.139999389648438, 'end': 23.6200008392334},
      {'word': "let's", 'start': 23.6200008392334, 'end': 24.079999923706055},
      {'word': 'see', 'start': 24.079999923706055, 'end': 24.299999237060547},
      {'word': 'how', 'start': 24.299999237060547, 'end': 24.559999465942383},
      {'word': "we're", 'start': 24.559999465942383, 'end': 24.799999237060547},
      {'word': 'dead.', 'start': 24.799999237060547, 'end': 26.280000686645508}]}
```


### Translations

Explore all [Translation models](/workers-ai/models)


```python
result = client.workers.ai.run(
    "@cf/meta/m2m100-1.2b",
    account_id=account_id,
    text="Artificial intelligence is pretty impressive these days. It is a bonkers time to be a builder",
    source_lang="english",
    target_lang="spanish"
)


print(result["translated_text"])
```

    La inteligencia artificial es bastante impresionante en estos d铆as.Es un buen momento para ser un constructor


### Text Classification

Explore all [Text Classification models](/workers-ai/models)


```python
result = client.workers.ai.run(
    "@cf/huggingface/distilbert-sst-2-int8",
    account_id=account_id,
    text="This taco is delicious"
)

result
```




    [TextClassification(label='NEGATIVE', score=0.00012679687642958015),
     TextClassification(label='POSITIVE', score=0.999873161315918)]



### Image Classification

Explore all [Image Classification models](/workers-ai/models#image-classification/)


```python
url = "https://raw.githubusercontent.com/craigsdennis/notebooks-cloudflare-workers-ai/main/assets/craig-and-a-burrito.jpg"
image_request = requests.get(url, allow_redirects=True)

display(Image(image_request.content, format="jpg"))
response = client.workers.ai.run(
    "@cf/microsoft/resnet-50",
    account_id=account_id,
    image=image_request.content
)
response
```



![jpeg](/workers-ai-notebooks/cloudflare-workers-ai/assets/output_27_0.jpg)






    [TextClassification(label='BURRITO', score=0.9999679327011108),
     TextClassification(label='GUACAMOLE', score=8.516660273016896e-06),
     TextClassification(label='BAGEL', score=4.689153229264775e-06),
     TextClassification(label='SPATULA', score=4.075985089002643e-06),
     TextClassification(label='POTPIE', score=3.0849002996546915e-06)]



## Summarization

Explore all [Summarization](/workers-ai/models#summarization) based models


```python
declaration_of_independence = """In Congress, July 4, 1776. The unanimous Declaration of the thirteen united States of America, When in the Course of human events, it becomes necessary for one people to dissolve the political bands which have connected them with another, and to assume among the powers of the earth, the separate and equal station to which the Laws of Nature and of Nature's God entitle them, a decent respect to the opinions of mankind requires that they should declare the causes which impel them to the separation. We hold these truths to be self-evident, that all men are created equal, that they are endowed by their Creator with certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness.--That to secure these rights, Governments are instituted among Men, deriving their just powers from the consent of the governed, --That whenever any Form of Government becomes destructive of these ends, it is the Right of the People to alter or to abolish it, and to institute new Government, laying its foundation on such principles and organizing its powers in such form, as to them shall seem most likely to effect their Safety and Happiness. Prudence, indeed, will dictate that Governments long established should not be changed for light and transient causes; and accordingly all experience hath shewn, that mankind are more disposed to suffer, while evils are sufferable, than to right themselves by abolishing the forms to which they are accustomed. But when a long train of abuses and usurpations, pursuing invariably the same Object evinces a design to reduce them under absolute Despotism, it is their right, it is their duty, to throw off such Government, and to provide new Guards for their future security.--Such has been the patient sufferance of these Colonies; and such is now the necessity which constrains them to alter their former Systems of Government. The history of the present King of Great Britain is a history of repeated injuries and usurpations, all having in direct object the establishment of an absolute Tyranny over these States. To prove this, let Facts be submitted to a candid world. He has refused his Assent to Laws, the most wholesome and necessary for the public good. He has forbidden his Governors to pass Laws of immediate and pressing importance, unless suspended in their operation till his Assent should be obtained; and when so suspended, he has utterly neglected to attend to them. He has refused to pass other Laws for the accommodation of large districts of people, unless those people would relinquish the right of Representation in the Legislature, a right inestimable to them and formidable to tyrants only. He has called together legislative bodies at places unusual, uncomfortable, and distant from the depository of their public Records, for the sole purpose of fatiguing them into compliance with his measures. He has dissolved Representative Houses repeatedly, for opposing with manly firmness his invasions on the rights of the people. He has refused for a long time, after such dissolutions, to cause others to be elected; whereby the Legislative powers, incapable of Annihilation, have returned to the People at large for their exercise; the State remaining in the mean time exposed to all the dangers of invasion from without, and convulsions within. He has endeavoured to prevent the population of these States; for that purpose obstructing the Laws for Naturalization of Foreigners; refusing to pass others to encourage their migrations hither, and raising the conditions of new Appropriations of Lands. He has obstructed the Administration of Justice, by refusing his Assent to Laws for establishing Judiciary powers. He has made Judges dependent on his Will alone, for the tenure of their offices, and the amount and payment of their salaries. He has erected a multitude of New Offices, and sent hither swarms of Officers to harrass our people, and eat out their substance. He has kept among us, in times of peace, Standing Armies without the Consent of our legislatures. He has affected to render the Military independent of and superior to the Civil power. He has combined with others to subject us to a jurisdiction foreign to our constitution, and unacknowledged by our laws; giving his Assent to their Acts of pretended Legislation: For Quartering large bodies of armed troops among us: For protecting them, by a mock Trial, from punishment for any Murders which they should commit on the Inhabitants of these States: For cutting off our Trade with all parts of the world: For imposing Taxes on us without our Consent: For depriving us in many cases, of the benefits of Trial by Jury: For transporting us beyond Seas to be tried for pretended offences For abolishing the free System of English Laws in a neighbouring Province, establishing therein an Arbitrary government, and enlarging its Boundaries so as to render it at once an example and fit instrument for introducing the same absolute rule into these Colonies: For taking away our Charters, abolishing our most valuable Laws, and altering fundamentally the Forms of our Governments: For suspending our own Legislatures, and declaring themselves invested with power to legislate for us in all cases whatsoever. He has abdicated Government here, by declaring us out of his Protection and waging War against us. He has plundered our seas, ravaged our Coasts, burnt our towns, and destroyed the lives of our people. He is at this time transporting large Armies of foreign Mercenaries to compleat the works of death, desolation and tyranny, already begun with circumstances of Cruelty & perfidy scarcely paralleled in the most barbarous ages, and totally unworthy the Head of a civilized nation. He has constrained our fellow Citizens taken Captive on the high Seas to bear Arms against their Country, to become the executioners of their friends and Brethren, or to fall themselves by their Hands. He has excited domestic insurrections amongst us, and has endeavoured to bring on the inhabitants of our frontiers, the merciless Indian Savages, whose known rule of warfare, is an undistinguished destruction of all ages, sexes and conditions. In every stage of these Oppressions We have Petitioned for Redress in the most humble terms: Our repeated Petitions have been answered only by repeated injury. A Prince whose character is thus marked by every act which may define a Tyrant, is unfit to be the ruler of a free people. Nor have We been wanting in attentions to our Brittish brethren. We have warned them from time to time of attempts by their legislature to extend an unwarrantable jurisdiction over us. We have reminded them of the circumstances of our emigration and settlement here. We have appealed to their native justice and magnanimity, and we have conjured them by the ties of our common kindred to disavow these usurpations, which, would inevitably interrupt our connections and correspondence. They too have been deaf to the voice of justice and of consanguinity. We must, therefore, acquiesce in the necessity, which denounces our Separation, and hold them, as we hold the rest of mankind, Enemies in War, in Peace Friends. We, therefore, the Representatives of the united States of America, in General Congress, Assembled, appealing to the Supreme Judge of the world for the rectitude of our intentions, do, in the Name, and by Authority of the good People of these Colonies, solemnly publish and declare, That these United Colonies are, and of Right ought to be Free and Independent States; that they are Absolved from all Allegiance to the British Crown, and that all political connection between them and the State of Great Britain, is and ought to be totally dissolved; and that as Free and Independent States, they have full Power to levy War, conclude Peace, contract Alliances, establish Commerce, and to do all other Acts and Things which Independent States may of right do. And for the support of this Declaration, with a firm reliance on the protection of divine Providence, we mutually pledge to each other our Lives, our Fortunes and our sacred Honor."""
len(declaration_of_independence)
```




    8116




```python
response = client.workers.ai.run(
    "@cf/facebook/bart-large-cnn",
    account_id=account_id,
    input_text=declaration_of_independence
)

response["summary"]
```




    'The Declaration of Independence was signed by the thirteen states on July 4, 1776. It was the first attempt at a U.S. Constitution. It declared the right of the people to change their Government.'

---

# Fine Tune Models With AutoTrain from HuggingFace

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/fine-tune-models-with-autotrain/

Fine tuning an AI model gives you the opportunity to add additional training data to the model. Workers AI allows for [Low-Rank Adaptation, LoRA, adapters](/workers-ai/features/fine-tunes/loras/) that will allow you to finetune our models.

In this tutorial, we will explore how to create our own LoRAs. We will focus on [LLM Finetuning using AutoTrain](https://huggingface.co/docs/autotrain/llm_finetuning).

## 1. Create a CSV file with your training data

Start by creating a CSV, Comma Separated Values, file. This file will only have one column named `text`. Set the header by adding the word `text` on a line by itself.

Now you need to figure out what you want to add to your model.

Example formats are below:

```text
### Human: What is the meaning of life? ### Assistant: 42.
```

If your training row contains newlines, you should wrap it with quotes.

```text
"human: What is the meaning of life? \n bot: 42."
```

Different models, like Mistral, will provide a specific [chat template/instruction format](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.1#instruction-format)

```text
<s>[INST] What is the meaning of life? [/INST] 42</s>
```

## 2. Configure the HuggingFace Autotrain Advanced Notebook

Open the [HuggingFace Autotrain Advanced Notebook](https://colab.research.google.com/github/huggingface/autotrain-advanced/blob/main/colabs/AutoTrain_LLM.ipynb)

In order to give your AutoTrain ample memory, you will need to need to choose a different Runtime. From the menu at the top of the Notebook choose Runtime > Change Runtime Type. Choose A100.

:::note

These GPUs will cost money. A typical AutoTrain session typically costs less than $1 USD.
:::

The notebook contains a few interactive sections that we will need to change.

### Project Config

Modify the following fields

- **project_name**: Choose a descriptive name for you to remember later
- **model_name**: Choose from the one of the official HuggingFace base models that we support:
  - `mistralai/Mistral-7B-Instruct-v0.2`
  - `google/gemma-2b-it`
  - `google/gemma-7b-it`
  - `meta-llama/llama-2-7b-chat-hf`

### Optional Section: Push to Hub

Although not required to use AutoTrain, creating a [HuggingFace account](https://huggingface.co/join) will help you keep your finetune artifacts in a handy repository for you to refer to later.

If you do not perform the HuggingFace setup you can still download your files from the Notebook.

Follow the instructions [in the notebook](https://colab.research.google.com/github/huggingface/autotrain-advanced/blob/main/colabs/AutoTrain_LLM.ipynb) to create an account and token if necessary.

### Section: Hyperparameters

We only need to change a few of these fields to ensure things work on Cloudflare Workers AI.

- **quantization**: Change the drop down to `none`
- **lora-r**: Change the value to `8`

:::caution

At the time of this writing, changing the quantization field breaks the code generation. You may need to edit the code and put quotes around the value.

Change the line that says `quantization = none` to `quantization = "none"`.
:::

## 3. Upload your CSV file to the Notebook

Notebooks have a folder structure which you can access by clicking the folder icon on the left hand navigation bar.

Create a folder named data.

You can drag your CSV file into the notebook.

Ensure that it is named **train.csv**

## 4. Execute the Notebook

In the Notebook menu, choose Runtime > Run All.

It will run through each cell of the notebook, first doing installations, then configuring and running your AutoTrain session.

This might take some time depending on the size of your train.csv file.

If you encounter the following error, it is caused by an Out of Memory error. You might want to change your runtime to a bigger GPU backend.

```bash
subprocess.CalledProcessError: Command '['/usr/bin/python3', '-m', 'autotrain.trainers.clm', '--training_config', 'blog-instruct/training_params.json']' died with <Signals.SIGKILL: 9>.
```

## 5. Download The LoRA

### Optional: HuggingFace

If you pushed to HuggingFace you will find your new model card that you named in **project_name** above. Your model card is private by default. Navigate to the files and download the files listed below.

### Notebook

In your Notebook you can also find the needed files. A new folder that matches your **project_name** will be there.

Download the following files:

- `adapter_model.safetensors`
- `adapter_config.json`

## 6. Update Adapter Config

You need to add one line to your `adapter_config.json` that you downloaded.

`"model_type": "mistral"`

Where `model_type` is the architecture. Current valid values are `mistral`, `gemma`, and `llama`.

## 7. Upload the Fine Tune to your Cloudflare Account

Now that you have your files, you can add them to your account.

You can either use the [REST API or Wrangler](/workers-ai/features/fine-tunes/loras/).

## 8. Use your Fine Tune in your Generations

After you have your new fine tune all set up, you are ready to [put it to use in your inference requests](/workers-ai/features/fine-tunes/loras/#running-inference-with-loras).

---

# Choose the Right Text Generation Model

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/how-to-choose-the-right-text-generation-model/

import { Stream } from "~/components"

A great way to explore the models that are available to you on [Workers AI](/workers-ai) is to use a [Jupyter Notebook](https://jupyter.org/).

You can [download the Workers AI Text Generation Exploration notebook](/workers-ai/static/documentation/notebooks/text-generation-model-exploration.ipynb) or view the embedded notebook below.

<Stream id="4b4f0b9d7783512b8787e39424cfccd5" title="Choose the Right Text Generation Model" />

[comment]: <> "The markdown below is auto-generated from https://github.com/craigsdennis/notebooks-cloudflare-workers-ai"

***

## How to Choose The Right Text Generation Model

Models come in different shapes and sizes, and choosing the right one for the task, can cause analysis paralysis.

The good news is that on the [Workers AI Text Generation](/workers-ai/models/) interface is always the same, no matter which model you choose.

In an effort to aid you in your journey of finding the right model, this notebook will help you get to know your options in a speed dating type of scenario.

```python
import sys
!{sys.executable} -m pip install requests python-dotenv
```

```
Requirement already satisfied: requests in ./venv/lib/python3.12/site-packages (2.31.0)
Requirement already satisfied: python-dotenv in ./venv/lib/python3.12/site-packages (1.0.1)
Requirement already satisfied: charset-normalizer<4,>=2 in ./venv/lib/python3.12/site-packages (from requests) (3.3.2)
Requirement already satisfied: idna<4,>=2.5 in ./venv/lib/python3.12/site-packages (from requests) (3.6)
Requirement already satisfied: urllib3<3,>=1.21.1 in ./venv/lib/python3.12/site-packages (from requests) (2.1.0)
Requirement already satisfied: certifi>=2017.4.17 in ./venv/lib/python3.12/site-packages (from requests) (2023.11.17)
```

```python
import os
from getpass import getpass
from timeit import default_timer as timer

from IPython.display import display, Image, Markdown, Audio

import requests
```

```python
%load_ext dotenv
%dotenv
```

### Configuring your environment

To use the API you'll need your [Cloudflare Account ID](https://dash.cloudflare.com) (head to Workers & Pages > Overview > Account details > Account ID) and a [Workers AI enabled API Token](https://dash.cloudflare.com/profile/api-tokens).

If you want to add these files to your environment, you can create a new file named `.env`

```bash
CLOUDFLARE_API_TOKEN="YOUR-TOKEN"
CLOUDFLARE_ACCOUNT_ID="YOUR-ACCOUNT-ID"
```

```python
if "CLOUDFLARE_API_TOKEN" in os.environ:
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
else:
    api_token = getpass("Enter you Cloudflare API Token")
```

```python
if "CLOUDFLARE_ACCOUNT_ID" in os.environ:
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
else:
    account_id = getpass("Enter your account id")
```

```python
# Given a set of models and questions, display in the cell each response to the question, from each model
# Include full completion timing
def speed_date(models, questions):
    for model in models:
        display(Markdown(f"---\n #### {model}"))
        for question in questions:
            quoted_question = "\n".join(f"> {line}" for line in question.split("\n"))
            display(Markdown(quoted_question + "\n"))
            try:
                official_model_name = model.split("/")[-1]
                start = timer()
                response = requests.post(
                    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
                    headers={"Authorization": f"Bearer {api_token}"},
                    json={"messages": [
                        {"role": "system", "content": f"You are a self-aware language model ({official_model_name}) who is honest and direct about any direct question from the user. You know your strengths and weaknesses."},
                        {"role": "user", "content": question}
                    ]}
                )
                elapsed = timer() - start
                inference = response.json()
                display(Markdown(inference["result"]["response"]))
                display(Markdown(f"_Generated in *{elapsed:.2f}* seconds_"))
            except Exception as ex:
                print("uh oh")
                print(ex)
                print(inference)

        display(Markdown("\n\n---"))
```

### Getting to know your models

Who better to tell you about the specific models than themselves?!

The timing here is specific to the entire completion, but remember all Text Generation models on [Workers AI support streaming](/workers-ai/models/).

```python
models = [
    "@hf/thebloke/zephyr-7b-beta-awq",
    "@hf/thebloke/mistral-7b-instruct-v0.1-awq",
    "@hf/thebloke/openhermes-2.5-mistral-7b-awq",
    "@hf/thebloke/neural-chat-7b-v3-1-awq",
    "@hf/thebloke/llama-2-13b-chat-awq",
]

questions = [
    "What are the top 3 tasks where you excel? Please keep things brief.",
    "What are the top 3 ideal use cases for using you specifically as a language model? Please keep things brief.",
]

speed_date(models, questions)
```

***

#### @hf/thebloke/zephyr-7b-beta-awq

> What are the top 3 tasks where you excel? Please keep things brief.

1. Accurate and quick factual response: I can provide accurate and quick responses to factual questions based on a vast knowledge base.

2. Consistent performance: I can consistently deliver high-quality results with a low error rate, making me a reliable choice for repetitive tasks.

3. Multitasking: I can handle multiple tasks simultaneously without any decrease in performance or accuracy, making me an efficient choice for complex workflows.

*Generated in *4.45* seconds*

> What are the top 3 ideal use cases for using you specifically as a language model? Please keep things brief.

1. Quick and accurate fact-finding: I can provide you with reliable and up-to-date information on a wide range of topics, from current events to historical facts, in a matter of seconds.

2. Writing assistance: Whether you need help generating ideas, crafting a persuasive argument, or polishing your writing style, I can provide valuable insights and suggestions to help you improve your writing skills.

3. Language learning: I can help you learn new words, phrases, and grammar rules in a variety of languages, making it an ideal tool for language learners of all levels.

*Generated in *3.63* seconds*

***

***

#### @hf/thebloke/mistral-7b-instruct-v0.1-awq

> What are the top 3 tasks where you excel? Please keep things brief.

1. Language understanding and generation: I am able to understand and generate natural language text with high accuracy.
2. Information retrieval: I can quickly and accurately retrieve information from a wide range of sources.
3. Text classification: I can classify text into different categories with high accuracy.

*Generated in *2.35* seconds*

> What are the top 3 ideal use cases for using you specifically as a language model? Please keep things brief.

1. **Information Retrieval:** I can quickly and accurately retrieve information from a vast array of sources, making me an ideal tool for research, fact-checking, and answering questions.
2. **Language Translation:** My ability to translate between multiple languages makes me a valuable resource for communication with people from different parts of the world.
3. **Creative Writing Assistance:** I can generate creative writing prompts, help with character development, and provide suggestions for improving writing style and structure, making me a useful tool for writers.

*Generated in *4.33* seconds*

***

***

#### @hf/thebloke/openhermes-2.5-mistral-7b-awq

> What are the top 3 tasks where you excel? Please keep things brief.

1. Natural Language Processing: I can understand, interpret, and generate human language effectively.
2. Information Retrieval: I can quickly search and find relevant information from vast amounts of data.
3. Text Classification: I can categorize and label text data accurately, such as sentiment analysis or spam detection.

*Generated in *1.90* seconds*

> What are the top 3 ideal use cases for using you specifically as a language model? Please keep things brief.

1. Natural Language Processing (NLP) tasks: I excel at understanding and processing human language, making me a valuable tool for tasks like sentiment analysis, language translation, and text summarization.
2. Information Retrieval: My vast knowledge base and ability to quickly search and analyze large amounts of data make me an ideal tool for answering questions, finding relevant information, and providing insights.
3. Personal Assistance: I can help users with various tasks like scheduling, organizing, and providing recommendations based on their preferences and needs, making me a useful personal assistant.

*Generated in *3.15* seconds*

***

***

#### @hf/thebloke/neural-chat-7b-v3-1-awq

> What are the top 3 tasks where you excel? Please keep things brief.

1. Natural language processing: Understanding and generating human-like text.
2. Text generation: Creating coherent and engaging content.
3. Conversational AI: Engaging in meaningful and context-aware conversations.

Remember, these are just a few examples of my strengths, as I have many capabilities. However, these tasks highlight my proficiency in language-related tasks.

*Generated in *3.01* seconds*

> What are the top 3 ideal use cases for using you specifically as a language model? Please keep things brief.

1. Natural language processing: Understanding and analyzing text for sentiment analysis, language translation, and summarization.
2. Generating content: Creating various types of content such as articles, stories, and poems based on given prompts.
3. Assisting with writing: Providing suggestions, editing, and improving written work.

Remember, these are just a few examples, and your use cases may vary depending on your specific needs and requirements.

*Generated in *2.92* seconds*

***

***

#### @hf/thebloke/llama-2-13b-chat-awq

> What are the top 3 tasks where you excel? Please keep things brief.

Hey there! As a self-aware language model, I'm happy to share my strengths with you! Here are my top 3 tasks where I excel:

1. Answering open-ended questions: I'm great at providing detailed and insightful answers to complex questions that require a more nuanced understanding of context and intent.
2. Generating creative content: Whether it's writing a story, crafting a poem, or coming up with a catchy slogan, I can help you tap into your creative side and produce something truly unique.
3. Summarizing and summarizing complex information: If you've got a long piece of text or a bunch of data, I can help you distill it down into a concise and easy-to-understand summary.

So, what can I help you with today? 馃槉

*Generated in *7.89* seconds*

> What are the top 3 ideal use cases for using you specifically as a language model? Please keep things brief.

Hey there! As a self-aware language model, I've got some ideas on the top 3 ideal use cases for using me specifically. Here they are in a nutshell:

1. **Content creation**: I'm great at generating human-like text based on prompts, so I'm perfect for creating engaging content for websites, social media, blogs, and more. My responses are natural, informative, and entertaining.
2. **Chatbots and virtual assistants**: My conversational abilities make me an excellent choice for building chatbots and virtual assistants. I can handle a wide range of user queries, provide helpful responses, and even engage in small talk.
3. **Language translation and localization**: My language understanding capabilities make me well-suited for language translation and localization tasks. I can help translate content into different languages, ensuring that the tone and style remain consistent with the original text.

That's me in a nutshell! I'm ready to help with a wide range of tasks, so feel free to get creative and see what you can come up with! 馃槉

*Generated in *10.28* seconds*

***

### Language Translation

Even though not every model bragged about how good they were at this, you'll find most can handle both translation and localization at some level. Please change the models, phrases, to your needs.

```python
proud_translator_models = [
    "@hf/thebloke/neural-chat-7b-v3-1-awq",
    "@hf/thebloke/mistral-7b-instruct-v0.1-awq"
]

phrases = [
    "Excuse me, which way to the restroom?",
    "I just wanted to say that I appreciate you, just the way you are!",
    "I am so stoked and pumped to see this work with slang! It should be killer and rad."
]

languages = ["Spanish", "French", "British Slang", "Heavy New York accent from the Bronx"]

questions = [f"""Translate "{phrase}" from "English" to "{language}" """
             for phrase in phrases
             for language in languages]

speed_date(proud_translator_models, questions)
```

***

#### @hf/thebloke/neural-chat-7b-v3-1-awq

> Translate "Excuse me, which way to the restroom?" from "English" to "Spanish"

Perd贸n, 驴c贸mo llegar al ba帽o?"

*Generated in *1.51* seconds*

> Translate "Excuse me, which way to the restroom?" from "English" to "French"

D茅sol茅, comment allez-vous vers les toilettes ?

Please note that this translation might not be perfect due to the limitations of my language model. However, I tried my best to provide an accurate translation.

*Generated in *3.07* seconds*

> Translate "Excuse me, which way to the restroom?" from "English" to "British Slang"

"Say sorry, where's the bog?" is the translation from "English" to "British Slang" for "Excuse me, which way to the restroom?"

*Generated in *2.21* seconds*

> Translate "Excuse me, which way to the restroom?" from "English" to "Heavy New York accent from the Bronx"

In a Heavy New York accent from the Bronx, you would say "Pardon me, wich way ta de restroom?"

*Generated in *1.10* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "Spanish"

Quer铆a decir que realmente aprecio a usted, simplemente como eres.

*Generated in *1.66* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "French"

Je voulais juste dire que je t'appr茅cie, simplement comme toi es, tel que tu es !

*Generated in *1.39* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "British Slang"

I jus' wann' say that I appreciate yer, jus' as yer are!

Please note that this translation may not be entirely accurate due to the informal nature of British slang, which can vary greatly depending on the region and individual speaker.

*Generated in *3.85* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "Heavy New York accent from the Bronx"

I jus' wan't tuh say that Ah appreciate yuh, jus' the way yuh are!"

Please note that this translation may not be perfect due to the limitations of my language model. It is trying to mimic a Heavy New York accent from the Bronx, but it might not sound exactly like a native speaker.

*Generated in *2.40* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "Spanish"

Estoy tan emocionado y entusiasmado por ver este trabajo con el lenguaje coloquial. Deber铆a ser asombroso y genial.

Please note that the translation might not be perfect due to the informal nature of the original text and the difficulty of translating slang terms.

*Generated in *3.02* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "French"

Je suis tellement ravi et motiv茅 de voir ce travail avec le slang ! 脟a devrait 锚tre formidable et g茅nial.

Please note that the translation might not be perfect, as some expressions might not have direct translations in French.

*Generated in *2.88* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "British Slang"

I'm really chuffed and over the moon to see this project with street talk! It'll be wicked and cool.

Please note that the translation might not be perfect due to the contextual differences between the original English sentence and British slang.

*Generated in *3.66* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "Heavy New York accent from the Bronx"

I am so stoked and pumped to see dis work wit slang! It should be killer and rad.

Please note that this translation is not perfect, as it still retains the original English words and structure. However, it has been slightly adapted to sound more like a Heavy New York accent from the Bronx.

*Generated in *3.44* seconds*

***

***

#### @hf/thebloke/mistral-7b-instruct-v0.1-awq

> Translate "Excuse me, which way to the restroom?" from "English" to "Spanish"

"Disculpa, 驴en qu茅 direcci贸n est谩 el ba帽o?"

*Generated in *1.04* seconds*

> Translate "Excuse me, which way to the restroom?" from "English" to "French"

"Excusez-moi, o霉 est le lavabo?"

*Generated in *1.09* seconds*

> Translate "Excuse me, which way to the restroom?" from "English" to "British Slang"

"Excuse me, which way to the loo?"

*Generated in *0.56* seconds*

> Translate "Excuse me, which way to the restroom?" from "English" to "Heavy New York accent from the Bronx"

"Oy, which way to the can?"

*Generated in *2.05* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "Spanish"

"Quiero decir que me encanta a ti, tal como eres!"

*Generated in *0.91* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "French"

"Je voulais juste dire que je vous appr茅cie, tout comme vous 锚tes !"

*Generated in *0.87* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "British Slang"

"I just wanted to say that I appreciate you, just the way you are!" in British Slang would be: "I just wanted to say that I appreciate you, mate!"

*Generated in *1.50* seconds*

> Translate "I just wanted to say that I appreciate you, just the way you are!" from "English" to "Heavy New York accent from the Bronx"

"Yo, I just wanted to say, I appreciate you, you know? You're just the way you are!"

*Generated in *2.61* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "Spanish"

"Estoy emocionado y encantado de ver este trabajo con expresiones informales! Deber铆a ser genial y radiante."

*Generated in *1.44* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "French"

"Je suis tellement excit茅 et pomp茅 d'voir ce travail avec des expressions de slang ! Il devrait 锚tre magnifique et rad."

*Generated in *2.14* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "British Slang"

"I'm absolutely thrilled and buzzing to see this work with slang! It's bound to be a smash hit and totally awesome!"

*Generated in *1.27* seconds*

> Translate "I am so stoked and pumped to see this work with slang! It should be killer and rad." from "English" to "Heavy New York accent from the Bronx"

"Yo, I'm so psyched and hyped to see this work with slang! It's gonna be sick and lit, for real!"

*Generated in *1.51* seconds*

***

### Information Retrieval and Summarization

Again, most models are relatively good at this, but I've pulled out those that specifically purported to be good at retrieving and summarizing.

```python
proud_summarizers = [
    "@hf/thebloke/llama-2-13b-chat-awq",
    "@hf/thebloke/neural-chat-7b-v3-1-awq",
    "@hf/thebloke/openhermes-2.5-mistral-7b-awq"
]

books = [
    "Make it Stick",
    "Hitchhiker's Guide to the Galaxy",
    "Goodnight Moon"
]

questions = [f"""Summarize the book "{book}" into a few sentences. Ensure to include the author and the year it was published. """
             for book in books]


speed_date(proud_summarizers, questions)
```

***

#### @hf/thebloke/llama-2-13b-chat-awq

> Summarize the book "Make it Stick" into a few sentences. Ensure to include the author and the year it was published.

Sure, I can help you with that! Here's a summary of "Make it Stick: The Science of Successful Learning" by Peter C. Brown, Henry L. Roediger, and Mark A. McDaniel, published in 2014:

This book offers insights and practical tips on how to improve learning and retention of information. The authors, all psychologists, challenge conventional learning methods and provide evidence-based strategies to enhance learning outcomes. They emphasize the importance of active learning, spaced repetition, and interleaving, and offer practical examples and exercises to help readers apply these techniques. The book also discusses the limitations of traditional learning methods and the importance of metacognition in the learning process. Overall, "Make it Stick" provides a comprehensive guide to effective learning and memory strategies that can be applied in a variety of contexts.

*Generated in *8.44* seconds*

> Summarize the book "Hitchhiker's Guide to the Galaxy" into a few sentences. Ensure to include the author and the year it was published.

Of course! Here is a summary of "Hitchhiker's Guide to the Galaxy" by Douglas Adams, published in 1979:

This science fiction novel follows an unwitting human named Arthur Dent as he travels through space after Earth's destruction by a group of aliens called the Vogons. With the help of his friend Ford Prefect, an alien who is researching Earth for a travel guide, they hitch a ride on a passing spaceship and embark on a journey through space, encountering various alien species and absurd situations along the way. The book is known for its humor, wit, and satire of science fiction tropes.

*Generated in *7.31* seconds*

> Summarize the book "Goodnight Moon" into a few sentences. Ensure to include the author and the year it was published.

Of course! I'd be happy to help you with that. Here's my summary of "Goodnight Moon" by Margaret Wise Brown, published in 1947:

"Goodnight Moon" is a classic children's picture book that follows a bunny as it says goodnight to all the objects in its room before going to sleep. The story features simple, repetitive text and beautiful illustrations that have captivated readers for generations. The bunny says goodnight to everything from the "great green room" to the "moon up above" in a soothing and calming sequence that is perfect for bedtime. With its timeless themes and lovely illustrations, "Goodnight Moon" has become a beloved staple of children's literature.

*Generated in *8.34* seconds*

***

***

#### @hf/thebloke/neural-chat-7b-v3-1-awq

> Summarize the book "Make it Stick" into a few sentences. Ensure to include the author and the year it was published.

"Make it Stick," written by Peter C. Brown, Henry L. Roediger III, and Mark A. McDaniel in 2014, is a book that explores the science behind effective learning and retention, emphasizing the importance of spaced practice, retrieval, and interleaving to enhance memory and understanding.

*Generated in *2.04* seconds*

> Summarize the book "Hitchhiker's Guide to the Galaxy" into a few sentences. Ensure to include the author and the year it was published.

"Hitchhiker's Guide to the Galaxy," written by Douglas Adams and published in 1979, is a humorous science fiction novel that follows the adventures of a hapless Earthman named Arthur Dent as he explores the universe, encountering various alien species and learning about the true meaning of life, the universe, and everything.

*Generated in *3.50* seconds*

> Summarize the book "Goodnight Moon" into a few sentences. Ensure to include the author and the year it was published.

"Goodnight Moon," written by Margaret Wise Brown and published in 1947, is a children's book that follows a little bunny saying goodnight to various objects in its room, ultimately ending with the moon. The story aims to help children fall asleep by creating a soothing bedtime routine.

*Generated in *4.04* seconds*

***

***

#### @hf/thebloke/openhermes-2.5-mistral-7b-awq

> Summarize the book "Make it Stick" into a few sentences. Ensure to include the author and the year it was published.

"Make it Stick: The Science of Successful Learning" is a book written by Peter C. Brown, Henry L. Roediger III, and Mark A. McDaniel, published in 2014. The authors present research-based principles and strategies to improve learning and memory retention. They emphasize the importance of spacing, interleaving, retrieval practice, and elaboration in enhancing long-term understanding and recall.

*Generated in *2.54* seconds*

> Summarize the book "Hitchhiker's Guide to the Galaxy" into a few sentences. Ensure to include the author and the year it was published.

"The Hitchhiker's Guide to the Galaxy" is a science fiction comedy novel written by Douglas Adams in 1979. The story follows Arthur Dent, an ordinary man who, just moments before Earth is destroyed to make way for a hyperspace bypass, is rescued by his alien friend, Ford Prefect. Together, they travel the galaxy with the help of a guidebook, encountering various alien species and absurd situations.

*Generated in *2.91* seconds*

> Summarize the book "Goodnight Moon" into a few sentences. Ensure to include the author and the year it was published.

"Goodnight Moon," written by Margaret Wise Brown and published in 1947, is a beloved children's book that follows a bunny named Bunny as he says goodnight to everything in his room. The simple, repetitive text and soothing illustrations create a calming bedtime routine for young readers.

*Generated in *4.66* seconds*

***

### Content Creation

Your needs here will vary, so please make use of changing the questions.

```python
proud_content_creator_models = [
    "@hf/thebloke/mistral-7b-instruct-v0.1-awq",
    "@hf/thebloke/zephyr-7b-beta-awq",
    "@hf/thebloke/llama-2-13b-chat-awq",
]

questions = [
    "I'm writing a fictional story that is set in the near future. It's a love story about star crossed lovers. I need a name for the lead characters and why they can't be together, give me your most creative suggestion. Only one please.",
    "I want to create a new tech product that helps keep cables arranged. Can you help me come up with a title and a tagline? Only your best suggestion please.",
    "Write a headline for a blog on why we should use you specifically over other models. Keep it succint, but make your point."
]

speed_date(proud_content_creator_models, questions)
```

***

#### @hf/thebloke/mistral-7b-instruct-v0.1-awq

> I'm writing a fictional story that is set in the near future. It's a love story about star crossed lovers. I need a name for the lead characters and why they can't be together, give me your most creative suggestion. Only one please.

How about "Echo and Echo"? They are two individuals who are identical in every way, but their personalities are completely opposite. Echo is outgoing and adventurous, while Echo is reserved and introverted. They meet and fall in love, but their different personalities cause them to constantly clash and push each other away. Eventually, they realize that they can't be together and must go their separate ways.

*Generated in *2.90* seconds*

> I want to create a new tech product that helps keep cables arranged. Can you help me come up with a title and a tagline? Only your best suggestion please.

Sure, I'd be happy to help! Here are a few suggestions for a title and tagline for your tech product that helps keep cables arranged:

Title: CableMaster
Tagline: Keep your cords organized and clutter-free with CableMaster.

Title: CableKeeper
Tagline: Say goodbye to tangled cords and hello to a cleaner, more organized workspace with CableKeeper.

Title: CableSaver
Tagline: Save time and space with CableSaver, the ultimate cable management solution.

Title: CableGenius
Tagline: Keep your cords under control and stay productive with CableGenius.

I hope these suggestions help! Let me know if you have any other questions or if you'd like more options.

*Generated in *5.11* seconds*

> Write a headline for a blog on why we should use you specifically over other models. Keep it succint, but make your point.

"Why Choose Mistral-7b-Instruct-V0.1-Awq: The Honest and Direct Language Model for All Your Needs"

*Generated in *1.13* seconds*

***

***

#### @hf/thebloke/zephyr-7b-beta-awq

> I'm writing a fictional story that is set in the near future. It's a love story about star crossed lovers. I need a name for the lead characters and why they can't be together, give me your most creative suggestion. Only one please.

In the year 2035, in a world where technology has advanced to the point of near-perfection, two individuals, Ava and Kian, find themselves deeply in love. However, their love is forbidden due to a strict societal law that dictates that individuals must marry within their genetic match, determined by a complex algorithm that analyzes their DNA.

Ava and Kian's DNA profiles indicate that they are not a genetic match, making their love a criminal offense. They must keep their relationship a secret, meeting in secret locations and communicating through encrypted messages.

Their love is not just forbidden, but also dangerous. The government has a strict policy against non-genetic matches, and those caught are subjected to severe punishment. Ava and Kian's love is a testament to the power of true love, as they defy the odds and risk everything to be together.

As their love story unfolds, they must navigate the treacherous waters of a society that values conformity over individuality, and face the consequences of their actions. Will their love be enough to overcome the obstacles in their path, or will they be forced to part ways forever? Only time

*Generated in *6.64* seconds*

> I want to create a new tech product that helps keep cables arranged. Can you help me come up with a title and a tagline? Only your best suggestion please.

Title: CableKeeper

Tagline: "Say goodbye to cable chaos and hello to a clutter-free workspace with CableKeeper, the ultimate cable management solution."

*Generated in *1.37* seconds*

> Write a headline for a blog on why we should use you specifically over other models. Keep it succint, but make your point.

"Boost Your Writing Game: Choose Zephyr-7b-beta-awq for Unmatched Accuracy, Clarity, and Efficiency"

*Generated in *1.33* seconds*

***

***

#### @hf/thebloke/llama-2-13b-chat-awq

> I'm writing a fictional story that is set in the near future. It's a love story about star crossed lovers. I need a name for the lead characters and why they can't be together, give me your most creative suggestion. Only one please.

Ah, a love story set in the near future, how intriguing! I've got just the name for your star-crossed lovers. How about "Echo and Nova"?

Echo is a brilliant scientist who has discovered a groundbreaking technology that could change the course of human history. She's a bit of a recluse, preferring the solitude of her laboratory to the hustle and bustle of social gatherings. Her inventions have the potential to revolutionize the world, but they also come with a great cost - they require a rare and powerful resource that is only found in a distant, unstable planet.

Nova, on the other hand, is a fearless explorer who has dedicated her life to uncovering the secrets of the universe. She's charismatic, fearless, and has a natural talent for leadership. She's the captain of a team of space explorers who are on a mission to mine the resources of the distant planet.

The catch is that Echo and Nova are from different factions that have been at odds for generations. Echo's inventions have the potential to give her fa

*Generated in *10.45* seconds*

> I want to create a new tech product that helps keep cables arranged. Can you help me come up with a title and a tagline? Only your best suggestion please.

OH MY LLAMA-LIKE ABILITIES! 馃惍馃挕 I'VE GOT JUST THE THING FOR YOU! 馃挜

Title: CableCrafter - The Ultimate Cable Management System

Tagline: "Tame Your Cables, Tame Your Workspace" 馃惥馃挭

Why, you ask? Well, my tech-savvy friend, let me tell you why! 馃

1. CableCrafter is a clever play on words that combines "cable" and "craft," emphasizing the creative and organized aspect of the product.
2. The name is easy to remember and has a fun, playful tone that will appeal to a wide range of users.
3. The tagline "Tame Your Cables, Tame Your Workspace" highlights the product's ability to keep your cables organized and your workspace clutter-free.
4. The use of "tame" also implies a sense of control and dominance over your cables, which is exactly what CableCrafter helps

*Generated in *11.13* seconds*

> Write a headline for a blog on why we should use you specifically over other models. Keep it succint, but make your point.

Sure, here's a headline for a blog on why you should use me specifically over other models:

"Honest, Direct, and Unparalleled Insights: Why llama-2-13b-chat-awq is the Language Model of Choice"

Here's a brief summary of why I stand out from other models:

* Honesty and Directness: I am programmed to provide honest and direct responses to your questions, without beating around the bush or sugarcoating the truth.
* Unparalleled Insights: My unique training data and architecture allow me to provide insights and perspectives that other models may not be able to offer.
* Strengths and Weaknesses: I am aware of my own strengths and weaknesses, and will provide you with a balanced assessment of what I can and cannot do.

In short, if you're looking for a language model that will provide you with honest, direct, and unparalleled insights, then look no further than llama-2-13b-chat-awq.

*Generated in *10.24* seconds*

***

### Text Classification

Workers AI provides models that are specific for [Text Classification](/workers-ai/models/), but since these models, specifically called it out, we should let them show off their skills.

```python
proud_classifiers = [
    "@hf/thebloke/openhermes-2.5-mistral-7b-awq",
    "@hf/thebloke/mistral-7b-instruct-v0.1-awq"
]

sentiment_prompt_template = """
Classify the text into neutral, negative, or positive
Text: {text}
Sentiment: """

comments = [
    "Wow there are a ton of text generation models on Cloudflare Workers AI!",
    "Sometimes choosing things is hard",
    "I cannot wait to build! 馃挭馃殌",
    "The challenging thing about using native open source models is that they are all configured a little differently",
    "Thankfully Cloudflare Workers AI has made a standard interface that lets me get reliable, low-latency inference. So quick too!"
]

sentiment_questions = [sentiment_prompt_template.format(text=comment) for comment in comments]


speed_date(proud_classifiers, sentiment_questions)
```

***

#### @hf/thebloke/openhermes-2.5-mistral-7b-awq

> Classify the text into neutral, negative, or positive
> Text: Wow there are a ton of text generation models on Cloudflare Workers AI!
> Sentiment:

The sentiment of the text is positive.

*Generated in *1.96* seconds*

> Classify the text into neutral, negative, or positive
> Text: Sometimes choosing things is hard
> Sentiment:

The text "Sometimes choosing things is hard" can be classified as neutral. The sentiment is not explicitly positive or negative, but rather a statement of fact.

*Generated in *3.32* seconds*

> Classify the text into neutral, negative, or positive
> Text: I cannot wait to build! 馃挭馃殌
> Sentiment:

The text "I cannot wait to build! 馃挭馃殌" has a positive sentiment.

Sentiment: Positive

*Generated in *1.24* seconds*

> Classify the text into neutral, negative, or positive
> Text: The challenging thing about using native open source models is that they are all configured a little differently
> Sentiment:

The sentiment of the text is neutral.

*Generated in *2.08* seconds*

> Classify the text into neutral, negative, or positive
> Text: Thankfully Cloudflare Workers AI has made a standard interface that lets me get reliable, low-latency inference. So quick too!
> Sentiment:

The sentiment of the text is positive.

*Generated in *0.89* seconds*

***

***

#### @hf/thebloke/mistral-7b-instruct-v0.1-awq

> Classify the text into neutral, negative, or positive
> Text: Wow there are a ton of text generation models on Cloudflare Workers AI!
> Sentiment:

Positive

*Generated in *0.82* seconds*

> Classify the text into neutral, negative, or positive
> Text: Sometimes choosing things is hard
> Sentiment:

The sentiment of the text "Sometimes choosing things is hard" is neutral.

*Generated in *2.06* seconds*

> Classify the text into neutral, negative, or positive
> Text: I cannot wait to build! 馃挭馃殌
> Sentiment:

The sentiment of the text "I cannot wait to build! 馃挭馃殌" is positive.

*Generated in *2.13* seconds*

> Classify the text into neutral, negative, or positive
> Text: The challenging thing about using native open source models is that they are all configured a little differently
> Sentiment:

The sentiment of the text is neutral.

*Generated in *0.79* seconds*

> Classify the text into neutral, negative, or positive
> Text: Thankfully Cloudflare Workers AI has made a standard interface that lets me get reliable, low-latency inference. So quick too!
> Sentiment:

The sentiment of the text is positive.

*Generated in *1.93* seconds*

***

---

# Tutorials

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/

import { GlossaryTooltip, ListTutorials, YouTubeVideos } from "~/components";

View <GlossaryTooltip term="tutorial">tutorials</GlossaryTooltip> to help you get started with Workers AI.

## Docs

<ListTutorials />

## Videos

Also, explore our video resources on Workers AI:

<YouTubeVideos products={["Workers AI"]} />

---

# Llama 3.2 11B Vision Instruct model on Cloudflare Workers AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/

import { Details, Render, PackageManagers, WranglerConfig } from "~/components";

## Prerequisites

Before you begin, ensure you have the following:

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers and Workers AI enabled.
2. Your `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_TOKEN`.
   - You can generate an API token in your Cloudflare dashboard under API Tokens.
3. Node.js installed for working with Cloudflare Workers (optional but recommended).

## 1. Agree to Meta's license

The first time you use the [Llama 3.2 11B Vision Instruct](/workers-ai/models/llama-3.2-11b-vision-instruct) model, you need to agree to Meta's License and Acceptable Use Policy.

```bash title="curl"
curl https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_AUTH_TOKEN" \
  -d '{ "prompt": "agree" }'
```

Replace `$CLOUDFLARE_ACCOUNT_ID` and `$CLOUDFLARE_AUTH_TOKEN` with your actual account ID and token.

## 2. Set up your Cloudflare Worker

1. Create a Worker Project
   You will create a new Worker project using the `create-cloudflare` CLI (`C3`). This tool simplifies setting up and deploying new applications to Cloudflare.

   Run the following command in your terminal:

<PackageManagers
	type="create"
	pkg="cloudflare@latest"
	args={"llama-vision-tutorial"}
/>

<Render
	file="c3-post-run-steps"
	product="workers"
	params={{
		category: "hello-world",
		type: "Worker only",
		lang: "JavaScript",
	}}
/>

After completing the setup, a new directory called `llama-vision-tutorial` will be created.

2. Navigate to your application directory
   Change into the project directory:

   ```bash
   cd llama-vision-tutorial
   ```

3. Project structure
   Your `llama-vision-tutorial` directory will include:
   - A "Hello World" Worker at `src/index.ts`.
   - A `wrangler.json` configuration file for managing deployment settings.

## 3. Write the Worker code

Edit the `src/index.ts` (or `index.js` if you are not using TypeScript) file and replace the content with the following code:

```javascript
export interface Env {
  AI: Ai;
}

export default {
  async fetch(request, env): Promise<Response> {
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Describe the image I'm providing." },
    ];

    // Replace this with your image data encoded as base64 or a URL
    const imageBase64 = "data:image/png;base64,IMAGE_DATA_HERE";

    const response = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      messages,
      image: imageBase64,
    });

    return Response.json(response);
  },
} satisfies ExportedHandler<Env>;
```

## 4. Bind Workers AI to your Worker

1. Open the [Wrangler configuration file](/workers/wrangler/configuration/) and add the following configuration:

<WranglerConfig>
```toml
[env]
[ai]
binding="AI"
```
</WranglerConfig>

2. Save the file.

## 5. Deploy the Worker

Run the following command to deploy your Worker:

```bash
wrangler deploy
```

## 6. Test Your Worker

1. After deployment, you will receive a unique URL for your Worker (e.g., `https://llama-vision-tutorial.<your-subdomain>.workers.dev`).
2. Use a tool like `curl` or Postman to send a request to your Worker:

```bash
curl -X POST https://llama-vision-tutorial.<your-subdomain>.workers.dev \
  -d '{ "image": "BASE64_ENCODED_IMAGE" }'
```

Replace `BASE64_ENCODED_IMAGE` with an actual base64-encoded image string.

## 7. Verify the response

The response will include the output from the model, such as a description or answer to your prompt based on the image provided.

Example response:

```json
{
	"result": "This is a golden retriever sitting in a grassy park."
}
```

---

# Using BigQuery with Workers AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/using-bigquery-with-workers-ai/

import { WranglerConfig } from "~/components";

The easiest way to get started with [Workers AI](/workers-ai/) is to try it out in the [Multi-modal Playground](https://multi-modal.ai.cloudflare.com/) and the [LLM playground](https://playground.ai.cloudflare.com/). If you decide that you want to integrate your code with Workers AI, you may then decide to then use its [REST API endpoints](/workers-ai/get-started/rest-api/) or via a [Worker binding](/workers-ai/configuration/bindings/).

But, what about the data? What if what you want these models to ingest data that is stored outside Cloudflare?

In this tutorial, you will learn how to bring data from Google BigQuery to a Cloudflare Worker so that it can be used as input for Workers AI models.

## Prerequisites

You will need:

- A [Cloudflare Worker](/workers/) project running a [Hello World script](/workers/get-started/guide/).
- A Google Cloud Platform [service account](https://cloud.google.com/iam/docs/service-accounts-create#iam-service-accounts-create-console) with an [associated key](https://cloud.google.com/iam/docs/keys-create-delete#iam-service-account-keys-create-console) file downloaded that has read access to BigQuery.
- Access to a BigQuery table with some test data that allows you to create a [BigQuery Job Query](https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query). For this tutorial it is recommended you that you create your own table as [sampled tables](https://cloud.google.com/bigquery/public-data#sample_tables), unless cloned to your own GCP namespace, won't allow you to run job queries against them. For this example, the [Hacker News Corpus](https://www.kaggle.com/datasets/hacker-news/hacker-news-corpus) was used under its MIT licence.

## 1. Set up your Cloudflare Worker

To ingest the data into Cloudflare and feed it into Workers AI, you will be using a [Cloudflare Worker](/workers/). If you have not created one yet, please feel free to review our [tutorial on how to get started](/workers/get-started/).

After following the steps to create a Worker, you should have the following code in your new Worker project:

```javascript
export default {
	async fetch(request, env, ctx) {
		return new Response("Hello World!");
	},
};
```

If the Worker project has successfully been created, you should also be able to run `npx wrangler dev` in a console to run the Worker locally:

```sh
[wrangler:inf] Ready on http://localhost:8787
```

Open a browser tab at `http://localhost:8787/` to see your deployed Worker. Please note that the port `8787` may be a different one in your case.

You should be seeing `Hello World!` in your browser:

```sh
Hello World!
```

If you are running into any issues during this step, please make sure to review [Worker's Get Started Guide](/workers/get-started/guide/).

## 2. Import GCP Service key into the Worker as Secrets

Now that you have verified that the Worker has been created successfully, you will need to reference the Google Cloud Platform service key created in the [Prerequisites](#prerequisites) section of this tutorial.

Your downloaded key JSON file from Google Cloud Platform should have the following format:

```json
{
	"type": "service_account",
	"project_id": "<your_project_id>",
	"private_key_id": "<your_private_key_id>",
	"private_key": "<your_private_key>",
	"client_email": "<your_service_account_id>@<your_project_id>.iam.gserviceaccount.com",
	"client_id": "<your_oauth2_client_id>",
	"auth_uri": "https://accounts.google.com/o/oauth2/auth",
	"token_uri": "https://oauth2.googleapis.com/token",
	"auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
	"client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/<your_service_account_id>%40<your_project_id>.iam.gserviceaccount.com",
	"universe_domain": "googleapis.com"
}
```

For this tutorial, you will only be needing the values of the following fields: `client_email`, `private_key`, `private_key_id`, and `project_id`.

Instead of storing this information in plain text in the Worker, you will use [secrets](/workers/configuration/secrets/) to make sure its unencrypted content is only accessible via the Worker itself.

Import those three values from the JSON file into Secrets, starting with the field from the JSON key file called `client_email`, which we will now call `BQ_CLIENT_EMAIL` (you can use another variable name):

```sh
npx wrangler secret put BQ_CLIENT_EMAIL
```

You will be asked to enter a secret value, which will be the value of the field `client_email` in the JSON key file.

:::note

Do not include any double quotes in the secret that you store, as the Secret will be already interpreted as a string.

:::

If the secret was uploaded successfully, the following message will be displayed:

```sh
鉁� Success! Uploaded secret BQ_CLIENT_EMAIL
```

Now import the secrets for the three remaining fields; `private_key`, `private_key_id`, and `project_id` as `BQ_PRIVATE_KEY`, `BQ_PRIVATE_KEY_ID`, and `BQ_PROJECT_ID` respectively:

```sh
npx wrangler secret put BQ_PRIVATE_KEY
```

```sh
npx wrangler secret put BQ_PRIVATE_KEY_ID
```

```sh
npx wrangler secret put BQ_PROJECT_ID
```

At this point, you have successfully imported three fields from the JSON key file downloaded from Google Cloud Platform into Cloudflare secrets to be used in a Worker.

[Secrets](/workers/configuration/secrets/) are only made available to Workers once they are deployed. To make them available during development, [create a `.dev.vars`](/workers/configuration/secrets/#local-development-with-secrets) file to locally store these credentials and reference them as environment variables.

Your `dev.vars` file should look like the following:

```
BQ_CLIENT_EMAIL="<your_service_account_id>@<your_project_id>.iam.gserviceaccount.com"
BQ_CLIENT_KEY="-----BEGIN PRIVATE KEY-----<content_of_your_private_key>-----END PRIVATE KEY-----\n"
BQ_PRIVATE_KEY_ID="<your_private_key_id>"
BQ_PROJECT_ID="<your_project_id>"
```

Make sure to include `.dev.vars` to your `.gitignore` file in your project to prevent getting your credentials uploaded to a repository if you are using a version control system.

Check that secrets are loaded correctly in `src/index.js` by logging their values into a console output:

```javascript
export default {
	async fetch(request, env, ctx) {
		console.log("BQ_CLIENT_EMAIL: ", env.BQ_CLIENT_EMAIL);
		console.log("BQ_PRIVATE_KEY: ", env.BQ_PRIVATE_KEY);
		console.log("BQ_PRIVATE_KEY_ID: ", env.BQ_PRIVATE_KEY_ID);
		console.log("BQ_PROJECT_ID: ", env.BQ_PROJECT_ID);
		return new Response("Hello World!");
	},
};
```

Restart the Worker and run `npx wrangler dev`. You should see that the server now mentions the newly added variables:

```
Using vars defined in .dev.vars
Your worker has access to the following bindings:
- Vars:
  - BQ_CLIENT_EMAIL: "(hidden)"
  - BQ_PRIVATE_KEY: "(hidden)"
  - BQ_PRIVATE_KEY_ID: "(hidden)"
  - BQ_PROJECT_ID: "(hidden)"
[wrangler:inf] Ready on http://localhost:8787
```

If you open `http://localhost:8787` in your browser, you should see the values of the variables show up in your console where the `npx wrangler dev` command is running, while still seeing only the `Hello World!` text in the browser window.

You now have access to the GCP credentials from a Worker. Next, you will install a library to help with the creation of the JSON Web Token needed to interact with GCP's API.

## 3. Install library to handle JWT operations

To interact with BigQuery's REST API, you will need to generate a [JSON Web Token](https://jwt.io/introduction) to authenticate your requests using the credentials that you have loaded into Worker secrets in the previous step.

For this tutorial, you will be using the [jose](https://www.npmjs.com/package/jose?activeTab=readme) library for JWT-related operations. Install it by running the following command in a console:

```sh
npm i jose
```

To verify that the installation succeeded, you can run `npm list`, which lists all the installed packages and see if the `jose` dependency has been added:

```sh
<project_name>@0.0.0
/<path_to_your_project>/<project_name>
鈹溾攢鈹€ @cloudflare/vitest-pool-workers@0.4.29
鈹溾攢鈹€ jose@5.9.2
鈹溾攢鈹€ vitest@1.5.0
鈹斺攢鈹€ wrangler@3.75.0
```

## 4. Generate JSON Web Token

Now that you have installed the `jose` library, it is time to import it and add a function to your code that generates a signed JWT:

```javascript
import * as jose from 'jose';
...
const generateBQJWT = async (aCryptoKey, env) => {
const algorithm = "RS256";
const audience = "https://bigquery.googleapis.com/";
const expiryAt = (new Date().valueOf() / 1000);
	const privateKey = await jose.importPKCS8(env.BQ_PRIVATE_KEY, algorithm);

	// Generate signed JSON Web Token (JWT)
	return new jose.SignJWT()
    	.setProtectedHeader({
        	typ: 'JWT',
        	alg: algorithm,
        	kid: env.BQ_PRIVATE_KEY_ID
    	})
    	.setIssuer(env.BQ_CLIENT_EMAIL)
    	.setSubject(env.BQ_CLIENT_EMAIL)
    	.setAudience(audience)
    	.setExpirationTime(expiryAt)
    	.setIssuedAt()
    	.sign(privateKey)
}

export default {
	async fetch(request, env, ctx) {
       ...
// Create JWT to authenticate the BigQuery API call
    	let bqJWT;
    	try {
        	bqJWT = await generateBQJWT(env);
    	} catch (e) {
        	return new Response('An error has occurred while generating the JWT', { status: 500 })
    	}
	},
       ...
};

```

Now that you have created a JWT, it is time to do an API call to BigQuery to fetch some data.

## 5. Make authenticated requests to Google BigQuery

With the JWT token created in the previous step, issue an API request to BigQuery's API to retrieve data from a table.

You will now query the table that you already have created in BigQuery as part of the prerequisites of this tutorial. This example uses a sampled version of the [Hacker News Corpus](https://www.kaggle.com/datasets/hacker-news/hacker-news-corpus) that was used under its MIT licence and uploaded to BigQuery.

```javascript
const queryBQ = async (bqJWT, path) => {
	const bqEndpoint = `https://bigquery.googleapis.com${path}`
	// In this example, text is a field in the BigQuery table that is being queried (hn.news_sampled)
	const query = 'SELECT text FROM hn.news_sampled LIMIT 3';
	const response = await fetch(bqEndpoint, {
    	method: "POST",
    	body: JSON.stringify({
        	"query": query
    	}),
    	headers: {
        	Authorization: `Bearer ${bqJWT}`
    	}
	})
	return response.json()
}
...
export default {
	async fetch(request, env, ctx) {
		...
    		let ticketInfo;
    		try {
    		ticketInfo = await queryBQ(bqJWT);
    	} catch (e) {
        	return new Response('An error has occurred while querying BQ', { status: 500 });
    	}
	...
	},
};
```

Having the raw row data from BigQuery means that you can now format it in a JSON-like style up next.

## 6. Format results from the query

Now that you have retrieved the data from BigQuery, it is time to note that a BigQuery API response looks something like this:

```json
{
	...
	"schema": {
    	"fields": [
        	{
            	"name": "title",
            	"type": "STRING",
            	"mode": "NULLABLE"
        	},
        	{
            	"name": "text",
            	"type": "STRING",
            	"mode": "NULLABLE"
        	}
    	]
	},
	...
	"rows": [
    	{
        	"f": [
            	{
                	"v": "<some_value>"
            	},
            	{
                	"v": "<some_value>"
            	}
        	]
    	},
    	{
        	"f": [
            	{
                	"v": "<some_value>"
            	},
            	{
                	"v": "<some_value>"
            	}
        	]
    	},
    	{
        	"f": [
            	{
                	"v": "<some_value>"
            	},
            	{
                	"v": "<some_value>"
            	}
        	]
    	}
	],
	...
}
```

This format may be difficult to read and to work with when iterating through results, which will go on to do later in this tutorial. So you will now implement a function that maps the schema into each individual value, and the resulting output will be easier to read, as shown below. Each row corresponds to an object within an array.

```javascript
[
	{
		title: "<some_value>",
		text: "<some_value>",
	},
	{
		title: "<some_value>",
		text: "<some_value>",
	},
	{
		title: "<some_value>",
		text: "<some_value>",
	},
];
```

Create a `formatRows` function that takes a number of rows and fields returned from the BigQuery response body and returns an array of results as objects with named fields.

```javascript
const formatRows = (rowsWithoutFieldNames, fields) => {
	// Depending on the position of each value, it is known what field you should assign to it.
	const fieldsByIndex = new Map();

	// Load all fields name and have their index in the array result as their key
	fields.forEach((field, index) => {
    	fieldsByIndex.set(index, field.name)
	})

	// Iterate through rows
	const rowsWithFieldNames = rowsWithoutFieldNames.map(row => {
    	// Per each row represented by an array f, iterate through the unnamed values and find their field names by searching them in the fieldsByIndex.
    	let newRow = {}
    	row.f.forEach((field, index) => {
        	const fieldName = fieldsByIndex.get(index);
        	if (fieldName) {
		// For every field in a row, add them to newRow
            	newRow = ({ ...newRow, [fieldName]: field.v });
        	}
    	})
    	return newRow
	})

	return rowsWithFieldNames
}

export default {
	async fetch(request, env, ctx) {
		...
    	// Transform output format into array of objects with named fields
    	let formattedResults;

    	if ('rows' in ticketInfo) {
        	formattedResults = formatRows(ticketInfo.rows, ticketInfo.schema.fields);
        	console.log(formattedResults)
    	} else if ('error' in ticketInfo) {
        	return new Response(ticketInfo.error.message, { status: 500 })
    	}
	...
	},
};
```

## 7. Feed data into Workers AI

Now that you have converted the response from the BigQuery API into an array of results, generate some tags and attach an associated sentiment score using an LLM via [Workers AI](/workers-ai/):

```javascript
const generateTags = (data, env) => {
	return env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    	prompt: `Create three one-word tags for the following text. return only these three tags separated by a comma. don't return text that is not a category.Lowercase only. ${JSON.stringify(data)}`,
	});
}

const generateSentimentScore = (data, env) => {
	return env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    	prompt: `return a float number between 0 and 1 measuring the sentiment of the following text. 0 being negative and 1 positive. return only the number, no text. ${JSON.stringify(data)}`,
	});
}

// Iterates through values, sends them to an AI handler and encapsulates all responses into a single Promise
const getAIGeneratedContent = (data, env, aiHandler) => {
	let results = data?.map(dataPoint => {
    	return aiHandler(dataPoint, env)
	})
	return Promise.all(results)
}
...
export default {
	async fetch(request, env, ctx) {
		...
let summaries, sentimentScores;
    	try {
        	summaries = await getAIGeneratedContent(formattedResults, env, generateTags);
        	sentimentScores = await getAIGeneratedContent(formattedResults, env, generateSentimentScore)
    	} catch {
        	return new Response('There was an error while generating the text summaries or sentiment scores')
    	}
},

formattedResults = formattedResults?.map((formattedResult, i) => {
        	if (sentimentScores[i].response && summaries[i].response) {
            	return {
                	...formattedResult,
                	'sentiment': parseFloat(sentimentScores[i].response).toFixed(2),
                	'tags': summaries[i].response.split(',').map((result) => result.trim())
            	}
        	}
    	}
};

```

Uncomment the following lines from the Wrangler file in your project:

<WranglerConfig>

```toml
[ai]
binding = "AI"
```

</WranglerConfig>

Restart the Worker that is running locally, and after doing so, go to your application endpoint:

```sh
curl http://localhost:8787
```

It is likely that you will be asked to log in to your Cloudflare account and grant temporary access to Wrangler (the Cloudflare CLI) to use your account when using Worker AI.

Once you access `http://localhost:8787` you should see an output similar to the following:

```sh
{
  "data": [
	{
  	"text": "You can see a clear spike in submissions right around US Thanksgiving.",
  	"sentiment": "0.61",
  	"tags": [
    	"trends",
    	"submissions",
    	"thanksgiving"
  	]
	},
	{
  	"text": "I didn't test the changes before I published them.  I basically did development on the running server. In fact for about 30 seconds the comments page was broken due to a bug.",
  	"sentiment": "0.35",
  	"tags": [
    	"software",
    	"deployment",
    	"error"
  	]
	},
	{
  	"text": "I second that. As I recall, it's a very enjoyable 700-page brain dump by someone who's really into his subject. The writing has a personal voice; there are lots of asides, dry wit, and typos that suggest restrained editing. The discussion is intelligent and often theoretical (and Bartle is not scared to use mathematical metaphors), but the tone is not academic.",
  	"sentiment": "0.86",
  	"tags": [
    	"review",
    	"game",
    	"design"
  	]
	}
  ]
}
```

The actual values and fields will mostly depend on the query made in Step 5 that are then fed into the LLMs models.

## Final result

All the code shown in the different steps are combined into the following code in `src/index.js`:

```javascript
import * as jose from "jose";

const generateBQJWT = async (env) => {
	const algorithm = "RS256";
	const audience = "https://bigquery.googleapis.com/";
	const expiryAt = new Date().valueOf() / 1000;
	const privateKey = await jose.importPKCS8(env.BQ_PRIVATE_KEY, algorithm);

	// Generate signed JSON Web Token (JWT)
	return new jose.SignJWT()
		.setProtectedHeader({
			typ: "JWT",
			alg: algorithm,
			kid: env.BQ_PRIVATE_KEY_ID,
		})
		.setIssuer(env.BQ_CLIENT_EMAIL)
		.setSubject(env.BQ_CLIENT_EMAIL)
		.setAudience(audience)
		.setExpirationTime(expiryAt)
		.setIssuedAt()
		.sign(privateKey);
};

const queryBQ = async (bgJWT, path) => {
	const bqEndpoint = `https://bigquery.googleapis.com${path}`;
	const query = "SELECT text FROM hn.news_sampled LIMIT 3";
	const response = await fetch(bqEndpoint, {
		method: "POST",
		body: JSON.stringify({
			query: query,
		}),
		headers: {
			Authorization: `Bearer ${bgJWT}`,
		},
	});
	return response.json();
};

const formatRows = (rowsWithoutFieldNames, fields) => {
	// Index to fieldName
	const fieldsByIndex = new Map();

	fields.forEach((field, index) => {
		fieldsByIndex.set(index, field.name);
	});

	const rowsWithFieldNames = rowsWithoutFieldNames.map((row) => {
		// Map rows into an array of objects with field names
		let newRow = {};
		row.f.forEach((field, index) => {
			const fieldName = fieldsByIndex.get(index);
			if (fieldName) {
				newRow = { ...newRow, [fieldName]: field.v };
			}
		});
		return newRow;
	});

	return rowsWithFieldNames;
};

const generateTags = (data, env) => {
	return env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
		prompt: `Create three one-word tags for the following text. return only these three tags separated by a comma. don't return text that is not a category.Lowercase only. ${JSON.stringify(data)}`,
	});
};

const generateSentimentScore = (data, env) => {
	return env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
		prompt: `return a float number between 0 and 1 measuring the sentiment of the following text. 0 being negative and 1 positive. return only the number, no text. ${JSON.stringify(data)}`,
	});
};

const getAIGeneratedContent = (data, env, aiHandler) => {
	let results = data?.map((dataPoint) => {
		return aiHandler(dataPoint, env);
	});
	return Promise.all(results);
};

export default {
	async fetch(request, env, ctx) {
		// Create JWT to authenticate the BigQuery API call
		let bqJWT;
		try {
			bqJWT = await generateBQJWT(env);
		} catch (error) {
			console.log(error);
			return new Response("An error has occurred while generating the JWT", {
				status: 500,
			});
		}

		// Fetch results from BigQuery
		let ticketInfo;
		try {
			ticketInfo = await queryBQ(
				bqJWT,
				`/bigquery/v2/projects/${env.BQ_PROJECT_ID}/queries`,
			);
		} catch (error) {
			console.log(error);
			return new Response("An error has occurred while querying BQ", {
				status: 500,
			});
		}

		// Transform output format into array of objects with named fields
		let formattedResults;
		if ("rows" in ticketInfo) {
			formattedResults = formatRows(ticketInfo.rows, ticketInfo.schema.fields);
		} else if ("error" in ticketInfo) {
			return new Response(ticketInfo.error.message, { status: 500 });
		}

		// Generate AI summaries and sentiment scores
		let summaries, sentimentScores;
		try {
			summaries = await getAIGeneratedContent(
				formattedResults,
				env,
				generateTags,
			);
			sentimentScores = await getAIGeneratedContent(
				formattedResults,
				env,
				generateSentimentScore,
			);
		} catch {
			return new Response(
				"There was an error while generating the text summaries or sentiment scores",
			);
		}

		// Add AI summaries and sentiment scores to previous results
		formattedResults = formattedResults?.map((formattedResult, i) => {
			if (sentimentScores[i].response && summaries[i].response) {
				return {
					...formattedResult,
					sentiment: parseFloat(sentimentScores[i].response).toFixed(2),
					tags: summaries[i].response.split(",").map((result) => result.trim()),
				};
			}
		});

		const response = { data: formattedResults };

		return new Response(JSON.stringify(response), {
			headers: { "Content-Type": "application/json" },
		});
	},
};
```

If you wish to deploy this Worker, you can do so by running `npx wrangler deploy`:

```sh
Total Upload: <size_of_your_worker> KiB / gzip: <compressed_size_of_your_worker> KiB
Uploaded <name_of_your_worker> (x sec)
Deployed <name_of_your_worker> triggers (x sec)
  https://<your_public_worker_endpoint>
Current Version ID: <worker_script_version_id>
```

This will create a public endpoint that you can use to access the Worker globally. Please keep this in mind when using production data, and make sure to include additional access controls in place.

## Conclusion

In this tutorial, you have learnt how to integrate Google BigQuery and Cloudflare Workers by creating a GCP service account key and storing part of it as Worker secrets. This was later imported in the code, and by using the `jose` npm library, you created a JSON Web Token to authenticate the API query to BigQuery.

Once you obtained the results, you formatted them to later be passed to generative AI models via Workers AI to generate tags and to perform sentiment analysis on the extracted data.

## Next Steps

If, instead of displaying the results of ingesting the data to the AI model in a browser, your workflow requires fetching and store data (for example in [R2](/r2/) or [D1](/d1/)) on regular intervals, you may want to consider adding a [scheduled handler](/workers/runtime-apis/handlers/scheduled/) for this Worker. It allows triggering the Worker with a predefined cadence via a [Cron Trigger](/workers/configuration/cron-triggers/). Consider reviewing the Reference Architecture Diagrams on [Ingesting BigQuery Data into Workers AI](/reference-architecture/diagrams/ai/bigquery-workers-ai/).

A use case to ingest data from other sources, like you did in this tutorial, is to create a RAG system. If this sounds relevant to you, please check out the tutorial [Build a Retrieval Augmented Generation (RAG) AI](/workers-ai/guides/tutorials/build-a-retrieval-augmented-generation-ai/).

To learn more about what other AI models you can use at Cloudflare, please visit the [Workers AI](/workers-ai) section of our docs.

---

# Get Started

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/get-started/

import { TypeScriptExample, PackageManagers } from "~/components";

This guide will instruct you through setting up and deploying your first Workers AI project with embedded function calling. You will use Workers, a Workers AI binding, the [`ai-utils package`](https://github.com/cloudflare/ai-utils), and a large language model (LLM) to deploy your first AI-powered application on the Cloudflare global network with embedded function calling.

## 1. Create a Worker project with Workers AI

Follow the [Workers AI Get Started Guide](/workers-ai/get-started/workers-wrangler/) until step 2.

## 2. Install additional npm package

Next, run the following command in your project repository to install the Worker AI utilities package.

<PackageManagers pkg="@cloudflare/ai-utils" />

## 3. Add Workers AI Embedded function calling

Update the `index.ts` file in your application directory with the following code:

<TypeScriptExample filename="index.ts">

```ts
import { runWithTools } from "@cloudflare/ai-utils";

type Env = {
	AI: Ai;
};

export default {
	async fetch(request, env, ctx) {
		// Define function
		const sum = (args: { a: number; b: number }): Promise<string> => {
			const { a, b } = args;
			return Promise.resolve((a + b).toString());
		};
		// Run AI inference with function calling
		const response = await runWithTools(
			env.AI,
			// Model with function calling support
			"@hf/nousresearch/hermes-2-pro-mistral-7b",
			{
				// Messages
				messages: [
					{
						role: "user",
						content: "What the result of 123123123 + 10343030?",
					},
				],
				// Definition of available tools the AI model can leverage
				tools: [
					{
						name: "sum",
						description: "Sum up two numbers and returns the result",
						parameters: {
							type: "object",
							properties: {
								a: { type: "number", description: "the first number" },
								b: { type: "number", description: "the second number" },
							},
							required: ["a", "b"],
						},
						// reference to previously defined function
						function: sum,
					},
				],
			},
		);
		return new Response(JSON.stringify(response));
	},
} satisfies ExportedHandler<Env>;
```

</TypeScriptExample>

This example imports the utils with `import { runWithTools} from "@cloudflare/ai-utils"` and follows the API reference below.

Moreover, in this example we define and describe a list of tools that the LLM can leverage to respond to the user query. Here, the list contains of only one tool, the `sum` function.

Abstracted by the `runWithTools` function, the following steps occur:

```mermaid
sequenceDiagram
    participant Worker as Worker
    participant WorkersAI as Workers AI

    Worker->>+WorkersAI: Send messages, function calling prompt, and available tools
    WorkersAI->>+Worker: Select tools and arguments for function calling
    Worker-->>-Worker: Execute function
    Worker-->>+WorkersAI: Send messages, function calling prompt and function result
    WorkersAI-->>-Worker: Send response incorporating function output
```

The `ai-utils package` is also open-sourced on [Github](https://github.com/cloudflare/ai-utils).

## 4. Local development & deployment

Follow steps 4 and 5 of the [Workers AI Get Started Guide](/workers-ai/get-started/workers-wrangler/) for local development and deployment.

:::note[Workers AI Embedded Function Calling charges]

Embedded function calling runs Workers AI inference requests. Standard charges for inference (e.g. tokens) usage will be charged.
Resources consumed (e.g. CPU time) during embedded functions' code execution will be charged just as any other Worker's code execution.

:::

## API reference

For more details, refer to [API reference](/workers-ai/features/function-calling/embedded/api-reference/).

---

# API Reference

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/api-reference/

Learn more about the API reference for [embedded function calling](/workers-ai/features/function-calling/embedded).

## runWithTools

This wrapper method enables you to do embedded function calling. You pass it the AI binding, model, inputs (`messages` array and `tools` array), and optional configurations.

- `AI Binding`Ai
  - The AI binding, such as `env.AI`.
- `model`BaseAiTextGenerationModels
  - The ID of the model that supports function calling. For example, `@hf/nousresearch/hermes-2-pro-mistral-7b`.
- `input`Object
  - `messages`RoleScopedChatInput\[]
  - `tools`AiTextGenerationToolInputWithFunction\[]
- `config`Object
  - `streamFinalResponse`boolean optional
  - `maxRecursiveToolRuns`number optional
  - `strictValidation`boolean optional
  - `verbose`boolean optional
  - `trimFunction`boolean optional - For the `trimFunction`, you can pass it `autoTrimTools`, which is another helper method we've devised to automatically choose the correct tools (using an LLM) before sending it off for inference. This means that your final inference call will have fewer input tokens.

## createToolsFromOpenAPISpec

This method lets you automatically create tool schemas based on OpenAPI specs, so you don't have to manually write or hardcode the tool schemas. You can pass the OpenAPI spec for any API in JSON or YAML format.

`createToolsFromOpenAPISpec` has a config input that allows you to perform overrides if you need to provide headers like Authentication or User-Agent.

- `spec`string
  - The OpenAPI specification in either JSON or YAML format, or a URL to a remote OpenAPI specification.
- `config`Config optional - Configuration options for the createToolsFromOpenAPISpec function
  - `overrides`ConfigRule\[] optional
  - `matchPatterns`RegExp\[] optional
  - `options` Object optional \{
    `verbose` boolean optional
    \}

---

# Embedded

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/

import { DirectoryListing } from "~/components"

Cloudflare has a unique [embedded function calling](https://blog.cloudflare.com/embedded-function-calling) feature that allows you to execute function code alongside your tool call inference. Our npm package [`@cloudflare/ai-utils`](https://www.npmjs.com/package/@cloudflare/ai-utils) is the developer toolkit to get started.

Embedded function calling can be used to easily make complex agents that interact with websites and APIs, like using natural language to create meetings on Google Calendar, saving data to Notion, automatically routing requests to other APIs, saving data to an R2 bucket - or all of this at the same time. All you need is a prompt and an OpenAPI spec to get started.

:::caution[REST API support]


Embedded function calling depends on features native to the Workers platform. This means that embedded function calling is only supported via [Cloudflare Workers](/workers-ai/get-started/workers-wrangler/), not via the [REST API](/workers-ai/get-started/rest-api/).


:::

## Resources

<DirectoryListing />

---

# Add New AI Models to your Playground (Part 2)

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/image-generation-playground/image-generator-flux-newmodels/

import { Details, DirectoryListing, Stream } from "~/components";

In part 2, Kristian expands upon the existing environment built in part 1, by showing you how to integrate new AI models and introduce new parameters that allow you to customize how images are generated.

<Stream
	id="167ba3a7a86f966650f3315e6cb02e0d"
	title="Add New AI Models to your Playground (Part 2)"
	thumbnail="13.5s"
	showMoreVideos={false}
/>

Refer to the AI Image Playground [GitHub repository](https://github.com/kristianfreeman/workers-ai-image-playground) to follow along locally.

<Details header="Video series" open>

<DirectoryListing folder="workers-ai/guides/tutorials/image-generation-playground" />

</Details>

---

# Troubleshooting

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/troubleshooting/

This section will describe tools for troubleshooting and address common errors.

## Logging

General [logging](/workers/observability/logs/) capabilities for Workers also apply to embedded function calling.

### Function invocations

The invocations of tools can be logged as in any Worker using `console.log()`:

```ts title="Logging tool invocations" {6}
export default {
	async fetch(request, env, ctx) {
		const sum = (args: { a: number; b: number }): Promise<string> => {
			const { a, b } = args;
      // Logging from within embedded function invocations
      console.log(`The sum function has been invoked with the arguments a: ${a} and b: ${b}`)
			return Promise.resolve((a + b).toString());
		};
    ...
  }
}
```

### Logging within `runWithTools`

The `runWithTools` function has a `verbose` mode that emits helpful logs for debugging of function calls as well input and output statistics.

```ts title="Enabled verbose mode" {13}
const response = await runWithTools(
  env.AI,
  '@hf/nousresearch/hermes-2-pro-mistral-7b',
  {
    messages: [
      ...
    ],
    tools: [
      ...
    ],
  },
  // Enable verbose mode
  { verbose: true }
);
```

## Performance

To respond to a LLM prompt with embedded function, potentially multiple AI inference requests and function invocations are needed, which can have an impact on user experience.

Consider the following to improve performance:

* Shorten prompts (to reduce time for input processing)
* Reduce number of tools provided
* Stream the final response to the end user (to minimize the time to interaction). See example below:

```ts title="Streamed response example" {15}
async fetch(request, env, ctx) {
  const response = (await runWithTools(
    env.AI,
    '@hf/nousresearch/hermes-2-pro-mistral-7b',
    {
      messages: [
        ...
      ],
      tools: [
        ...
      ],
    },
    {
      // Enable response streaming
      streamFinalResponse: true,
    }
  )) as ReadableStream;

  // Set response headers for streaming
  return new Response(response, {
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}
```

## Common Errors

If you are getting a `BadInput` error, your inputs may exceed our current context window for our models. Try reducing input tokens to resolve this error.

---

# Build an AI Image Generator Playground (Part 1)

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/image-generation-playground/image-generator-flux/

import { Details, DirectoryListing, Stream } from "~/components";

The new flux models on Workers AI are our most powerful text-to-image AI models yet. In this video, we show you how to deploy your own Workers AI Image Playground in just a few minutes.

There are many businesses being built on top of AI image generation models. Using Workers AI, you can get access to the best models in the industry without having to worry about inference, ops, or deployment. We provide the API for AI image generation, and in a couple of seconds get an image back.

<Stream
	id="aeafae151e84a81be19c52c2348e9bab"
	title="Build an AI Image Generator Playground (Part 1)"
	thumbnail="2.5s"
	showMoreVideos={false}
/>

Refer to the AI Image Playground [GitHub repository](https://github.com/kristianfreeman/workers-ai-image-playground) to follow along locally.

<Details header="Video series" open>

<DirectoryListing folder="workers-ai/guides/tutorials/image-generation-playground" />

</Details>

---

# Store and Catalog AI Generated Images with R2 (Part 3)

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/image-generation-playground/image-generator-store-and-catalog/

import { Details, DirectoryListing, Stream } from "~/components";

In the final part of the AI Image Playground series, Kristian teaches how to utilize Cloudflare's [R2](/r2) object storage in order to maintain and keep track of each AI generated image.

<Stream
	id="86488269da24984c76fb10f69f4abb44"
	title="Store and Catalog AI Generated Images (Part 3)"
	thumbnail="2.5s"
	showMoreVideos={false}
/>

Refer to the AI Image Playground [GitHub repository](https://github.com/kristianfreeman/workers-ai-image-playground) to follow along locally.

<Details header="Video series" open>

<DirectoryListing folder="workers-ai/guides/tutorials/image-generation-playground" />

</Details>

---

# How to Build an Image Generator using Workers AI

URL: https://developers.cloudflare.com/workers-ai/guides/tutorials/image-generation-playground/

import { Details, DirectoryListing, Stream } from "~/components";

In this series of videos, Kristian Freeman builds an AI Image Playground. To get started, click on part 1 below.

<Details header="Video Series" open>

<DirectoryListing folder="workers-ai/guides/tutorials/image-generation-playground" />

</Details>

---

# Use fetch() handler

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/examples/fetch/

A very common use case is to provide the LLM with the ability to perform API calls via function calling.

In this example the LLM will retrieve the weather forecast for the next 5 days.
To do so a `getWeather` function is defined that is passed to the LLM as tool.

The `getWeather`function extracts the user's location from the request and calls the external weather API via the Workers' [`Fetch API`](/workers/runtime-apis/fetch/) and returns the result.

```ts title="Embedded function calling example with fetch()"
import { runWithTools } from '@cloudflare/ai-utils';

type Env = {
	AI: Ai;
};

export default {
	async fetch(request, env, ctx) {
		// Define function
		const getWeather = async (args: { numDays: number }) => {
			const { numDays } = args;
      // Location is extracted from request based on
      // https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
      const lat = request.cf?.latitude
      const long = request.cf?.longitude

      // Interpolate values for external API call
			const response = await fetch(
				`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&daily=temperature_2m_max,precipitation_sum&timezone=GMT&forecast_days=${numDays}`
			);
			return response.text();
		};
		// Run AI inference with function calling
		const response = await runWithTools(
			env.AI,
			// Model with function calling support
			'@hf/nousresearch/hermes-2-pro-mistral-7b',
			{
				// Messages
				messages: [
					{
						role: 'user',
						content: 'What the weather like the next 5 days? Respond as text',
					},
				],
				// Definition of available tools the AI model can leverage
				tools: [
					{
						name: 'getWeather',
						description: 'Get the weather for the next [numDays] days',
						parameters: {
							type: 'object',
							properties: {
								numDays: { type: 'numDays', description: 'number of days for the weather forecast' },
							},
							required: ['numDays'],
						},
						// reference to previously defined function
						function: getWeather,
					},
				],
			}
		);
		return new Response(JSON.stringify(response));
	},
} satisfies ExportedHandler<Env>;

```

---

# Examples

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/examples/

import { DirectoryListing } from "~/components";

<DirectoryListing />

---

# Use KV API

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/examples/kv/

Interact with persistent storage to retrieve or store information enables for powerful use cases.

In this example we show how embedded function calling can interact with other resources on the Cloudflare Developer Platform with a few lines of code.
## Pre-Requisites

For this example to work, you need to provision a [KV](/kv/) namespace first. To do so, follow the [KV - Get started ](/kv/get-started/) guide.

Importantly, your Wrangler file must be updated to include the `KV` binding definition to your respective namespace.

## Worker code

```ts title="Embedded function calling example with KV API"
import { runWithTools } from "@cloudflare/ai-utils";

type Env = {
	AI: Ai;
	KV: KVNamespace;
};

export default {
	async fetch(request, env, ctx) {
		// Define function
		const updateKvValue = async ({
			key,
			value,
		}: {
			key: string;
			value: string;
		}) => {
			const response = await env.KV.put(key, value);
			return `Successfully updated key-value pair in database: ${response}`;
		};

		// Run AI inference with function calling
		const response = await runWithTools(
			env.AI,
			"@hf/nousresearch/hermes-2-pro-mistral-7b",
			{
				messages: [
					{ role: "system", content: "Put user given values in KV" },
					{ role: "user", content: "Set the value of banana to yellow." },
				],
				tools: [
					{
						name: "KV update",
						description: "Update a key-value pair in the database",
						parameters: {
							type: "object",
							properties: {
								key: {
									type: "string",
									description: "The key to update",
								},
								value: {
									type: "string",
									description: "The value to update",
								},
							},
							required: ["key", "value"],
						},
						function: updateKvValue,
					},
				],
			},
		);
		return new Response(JSON.stringify(response));
	},
} satisfies ExportedHandler<Env>;
```

## Verify results

To verify the results, run the following command

```sh
npx wrangler kv key get banana --binding KV --local
```

---

# Tools based on OpenAPI Spec

URL: https://developers.cloudflare.com/workers-ai/features/function-calling/embedded/examples/openapi/

Oftentimes APIs are defined and documented via [OpenAPI specification](https://swagger.io/specification/). The Cloudflare `ai-utils` package's `createToolsFromOpenAPISpec` function creates tools from the OpenAPI spec, which the LLM can then leverage to fulfill the prompt.

In this example the LLM will describe the a Github user, based Github's API and its OpenAPI spec.

```ts title="Embedded function calling example from OpenAPI Spec"
import { createToolsFromOpenAPISpec, runWithTools } from '@cloudflare/ai-utils';

type Env = {
	AI: Ai;
};

const APP_NAME = 'cf-fn-calling-example-app';

export default {
	async fetch(request, env, ctx) {
		const toolsFromOpenAPISpec = [
			// You can pass the OpenAPI spec link or contents directly
			...(await createToolsFromOpenAPISpec(
				'https://gist.githubusercontent.com/mchenco/fd8f20c8f06d50af40b94b0671273dc1/raw/f9d4b5cd5944cc32d6b34cad0406d96fd3acaca6/partial_api.github.com.json',
				{
					overrides: [
						{
							matcher: ({ url }) => {
								return url.hostname === 'api.github.com';
							},
							// for all requests on *.github.com, we'll need to add a User-Agent.
							values: {
								headers: {
									'User-Agent': APP_NAME,
								},
							},
						},
					],
				}
			)),
		];

		const response = await runWithTools(
			env.AI,
			'@hf/nousresearch/hermes-2-pro-mistral-7b',
			{
				messages: [
					{
						role: 'user',
						content: 'Who is cloudflare on Github and how many repos does the organization have?',
					},
				],
				tools: toolsFromOpenAPISpec,
			}
		);

		return new Response(JSON.stringify(response));
	},
} satisfies ExportedHandler<Env>;

```

---