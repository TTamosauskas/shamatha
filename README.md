# Shamatha — GitHub Pages + Supabase

Versão estática preparada especificamente para:

`https://ttamosauskas.github.io/shamatha/`

O GitHub Pages hospeda somente HTML/CSS/JavaScript. Supabase fornece autenticação, banco persistente e controle de acesso.

## Arquivos

- `index.html` — login e cadastro.
- `app.html` — caminho de meditação.
- `editor.html` — painel do editor.
- `assets/config.js` — URL e Publishable Key do Supabase.
- `assets/supabase-backend.js` — adaptação da API do protótipo para Supabase.
- `assets/shamatha-extensions.js` — Storage privado de áudio e gestão de múltiplos editores.
- `supabase-schema.sql` — tabelas, dados iniciais, trigger de cadastro e políticas RLS.
- `.nojekyll` — publicação como Static HTML.

## 1. Criar/configurar o Supabase

Crie um projeto Supabase e abra **SQL Editor**. Execute todo o conteúdo de `supabase-schema.sql`.

Em **Authentication → URL Configuration**, use:

- Site URL: `https://ttamosauskas.github.io/shamatha/`
- Redirect URL permitida: `https://ttamosauskas.github.io/shamatha/`

A confirmação de e-mail pode permanecer habilitada. Nesse caso o aluno confirma o endereço antes do primeiro login.

## 2. Preencher a configuração pública

Abra `assets/config.js` e preencha:

```js
window.SHAMATHA_CONFIG = Object.freeze({
  baseUrl: 'https://ttamosauskas.github.io/shamatha/',
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'sb_publishable_...'
});
```

Use somente a **Publishable Key** (ou anon key legada). A `service_role`/Secret Key jamais pertence ao GitHub Pages.

## 3. Criar o primeiro editor

Depois de o site estar ligado ao Supabase, cadastre sua própria conta pela página inicial e confirme o e-mail, quando solicitado.

No SQL Editor execute, trocando pelo seu e-mail:

```sql
update public.profiles
set role = 'editor', access_granted = true, is_owner = true
where email = lower('seu-email@exemplo.com');
```

Saia e entre novamente. A conta abrirá o painel `editor.html`.

## 4. Painel do editor

O editor pode:

- liberar ou suspender alunos pelo e-mail já cadastrado;
- promover outros usuários cadastrados a editor (e rebaixá-los novamente a aluno);
- definir vídeo e enviar o arquivo de áudio de cada uma das 9 etapas para o Storage privado;
- definir sessões mínimas, prazo e duração mínima de prática;
- salvar o link exato da aula ao vivo;
- configurar o WhatsApp do professor.

O botão **Ao Vivo** usa diretamente `settings.live_class_url`. O código deixou de consultar `mortesubita.net/aula-ao-vivo/`.

## 5. GitHub Pages

No repositório `TTamosauskas/shamatha`, use **Settings → Pages → Deploy from a branch**, branch `main`, pasta `/ (root)`.

Os caminhos do projeto são relativos, portanto funcionam dentro do subdiretório `/shamatha/`.

## Segurança

As páginas e o JavaScript são públicos por natureza no GitHub Pages. A autorização real acontece no Supabase por Row Level Security:

- conta pendente lê apenas o próprio perfil;
- aluno liberado lê as etapas/configurações e lê/grava somente o próprio progresso;
- editor lê alunos e altera permissões, etapas e configurações;
- nenhuma Secret Key fica no repositório.

## Áudios privados e múltiplos editores

O painel aceita upload de MP3, M4A, AAC, OGG, WAV e WEBM de até 100 MB. Os arquivos ficam no bucket privado `shamatha-audio`; somente editores podem enviar/remover, e alunos liberados recebem URLs assinadas temporárias para reprodução. A conta de editor principal é protegida contra rebaixamento, e o banco impede que o sistema fique sem pelo menos um editor ativo.
