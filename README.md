# pulse-kit

Biblioteca e servidor MCP do ecossistema Polar H10: openPulse, polar-drive-sync, TriTracker e o Claude.

| Pacote | O que faz |
| :--- | :--- |
| `@pulse-kit/h10` | Parsers Bluetooth do H10: Heart Rate Measurement (0x2A37, com R-R em 1/1024 s preservado) e quadros PMD de ECG (130 Hz) e acelerômetro (200 Hz), inclusive comprimidos. Extraídos do openPulse. |
| `@pulse-kit/hrv` | Matemática pura: filtro de artefatos do R-R, RMSSD, DFA α1 (caixas de 4 a 16), série deslizante de 2 min a cada 5 s, VT1/VT2 por regressão na rampa, TRIMP de Banister e Edwards, deriva de FC, tempo por zona, pausas, ATL/CTL/TSB e a regra pessoal de 48 h sem impacto. |
| `@pulse-kit/fit-session` | Grava FIT de atividade com a mensagem 78 (HRV, batimento a batimento) e lê FC e R-R de qualquer FIT. Usa o SDK oficial `@garmin/fitsdk`. |
| `@pulse-kit/schemas` | Contratos versionados (zod): `index_master` v2 do polar-drive-sync, exercício da AccessLink e a exportação de sessão do openPulse. JSON Schema em `packages/schemas/json/`. |
| `@pulse-kit/mcp` | Servidor MCP local (stdio) para o Claude Code e o Claude Desktop. |

## Servidor MCP

Ferramentas:

- `get_training_status`: ATL, CTL e TSB do dia a partir dos `index_master` do Drive, com a trava tibial de 48 h.
- `inspect_workout`: um treino da Polar por id (FC por quarto, deriva depois do aquecimento, zonas, Edwards, pausas).
- `analyze_recording`: sessão do openPulse (`.json`) ou FIT com R-R (`.fit`): artefatos, RMSSD, DFA α1 por minuto, tempo acima de VT1 e abaixo de VT2, limiares da rampa e queda ortostática.
- `trigger_polar_sync`: dispara o workflow do polar-drive-sync e espera terminar.

Instalação no PC (PowerShell ou bash):

```
git clone https://github.com/bielrodrigues2406/pulse-kit
cd pulse-kit
pnpm install
pnpm build
claude mcp add pulse-kit --scope user -- node <caminho>/pulse-kit/apps/mcp/dist/index.js
```

As variáveis estão em `.env.example`. Passe-as com `-e NOME=valor` no `claude mcp add` ou pelo plugin `claude-treino`. Nenhuma é obrigatória: a ferramenta cujo serviço falta responde dizendo o que configurar.

## Decisões

- **DFA α1 de ruído branco é cerca de 0,58, não 0,5.** Em caixas de 4 a 16 batimentos a DFA linear tem F²(n) ∝ (n²−4)/n (Kantelhardt et al., 2001); o 0,5 é o limite assintótico. Os testes comparam com o valor exato. Ruído 1/f dá cerca de 1,0 e browniano cerca de 1,5.
- **Artefatos acima de 5% não são pontuados; de 3% a 5%, a janela sai marcada como de baixa confiança** (Rogers et al., 2021, viés acima de cerca de 3%).
- **O filtro de artefatos se reancora.** O filtro herdado do openPulse comparava cada batimento com a mediana dos 5 últimos aceitos. Depois de um degrau sustentado (levantar no teste ortostático, ou sinal voltando depois de uma perda com a FC em outro patamar), ele rejeitava tudo para sempre. Agora 5 rejeições seguidas e coerentes entre si viram a nova referência.
- **FIT pelo SDK da Garmin**, que já tem encoder e decoder, roda no navegador e não tem dependências. O teste de ida e volta passa pelo `checkIntegrity` oficial.
- **TSB é o CTL menos o ATL de ontem**, como no TrainingPeaks: o treino de hoje não muda a forma de hoje.
- **A regra tibial conta 48 h a partir do fim da corrida.** É regra pessoal, não critério clínico.

## Desenvolvimento

Node 24 e pnpm 12, como o TriTracker. Mesmas opções estritas do TypeScript (`tsconfig.base.json` copiado de lá), para que o TriTracker possa consumir os pacotes sem conflito.

```
pnpm install      # também compila os pacotes
pnpm typecheck
pnpm test
```

Gravações reais não entram neste repositório público (`.gitignore` bloqueia `*.fit` e `recordings/`). Elas ficam no `physio-lab`, que deve ser privado.

## Como o openPulse e o polar-drive-sync usam

- **openPulse:** troca `src/domain/physiology/*` por `@pulse-kit/h10` e `@pulse-kit/hrv`. Até os pacotes irem para um registro (npm ou GitHub Packages), a forma mais simples é o openPulse passar a usar pnpm e depender de `github:bielrodrigues2406/pulse-kit#path:/packages/hrv`.
- **polar-drive-sync:** continua sem dependências por enquanto. Os cálculos de lá e de `@pulse-kit/hrv` usam as mesmas fórmulas, e o contrato do `index_master` é testado em `packages/schemas` com uma saída gerada pelo próprio sync.

O código ainda não tem licença declarada. Escolha uma antes de publicar pacotes. O `@garmin/fitsdk` tem licença própria (FIT Protocol License).
