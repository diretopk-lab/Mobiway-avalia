# MOBIWAY Avalia

Ferramenta interna da Mobiway para avaliação de viaturas usadas e decisão de compra.

## MVP 0.1

- identificação de viatura;
- fotografias por câmara/galeria;
- estado exterior, interior e mecânico;
- custos previstos de reparação/preparação;
- comparáveis de mercado;
- mediana robusta e ajuste simples por ano/km;
- score de risco e confiança;
- reserva de garantia;
- custo de stock;
- margem alvo Mobiway;
- oferta inicial, compra aconselhada e máximo absoluto;
- histórico local;
- registo Comprámos / Não comprámos;
- preço real de compra, reparação, venda e garantia;
- comparação previsão vs. resultado real;
- backup/importação JSON.

## APK automático

O workflow `.github/workflows/build-apk.yml` compila automaticamente um APK debug em cada push para `main` e também pode ser executado manualmente em **Actions > Build MOBIWAY Avalia APK > Run workflow**.

O artefacto produzido chama-se `MOBIWAY-Avalia-APK` e contém `MOBIWAY-Avalia-v0.1-debug.apk`.

## Arquitetura atual

O MVP é uma aplicação web offline embebida numa WebView Android nativa. Não envia fotografias nem dados para servidores. A pesquisa externa de mercado abre o navegador e os comparáveis são atualmente introduzidos manualmente.

A evolução recomendada é migrar a camada de dados para backend seguro, adicionar autenticação, sincronização, fontes autorizadas de mercado e visão computacional para análise das fotografias.
