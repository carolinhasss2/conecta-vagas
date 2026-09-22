# Conecta Vagas

O Conecta Vagas é um sistema desenvolvido para facilitar a conexão entre trabalhadores e recrutadores.

A ideia do projeto é permitir que recrutadores publiquem oportunidades de trabalho e que trabalhadores possam visualizar as vagas disponíveis e demonstrar interesse nas oportunidades que desejam participar.

## Sobre o projeto

O sistema foi desenvolvido como um projeto acadêmico com o objetivo de aplicar na prática conhecimentos de desenvolvimento web, banco de dados, autenticação de usuários e publicação de sistemas na internet.

O Conecta Vagas possui diferentes tipos de usuários, com permissões diferentes dentro do sistema.

### Trabalhador

O trabalhador pode:

- Criar uma conta;
- Fazer login;
- Preencher seu perfil;
- Visualizar vagas disponíveis;
- Utilizar os filtros de vagas;
- Abrir os detalhes de uma vaga;
- Demonstrar interesse em uma vaga;
- Consultar suas informações de perfil.

### Recrutador

O recrutador pode:

- Criar uma conta;
- Fazer login;
- Criar vagas;
- Editar suas próprias vagas;
- Excluir suas vagas;
- Visualizar pessoas interessadas em suas vagas;
- Acessar o perfil dos trabalhadores interessados.

Os novos recrutadores precisam ser aprovados antes de poderem publicar vagas.

## Funcionalidades

- Cadastro de usuários
- Login
- Perfis de usuários
- Diferenciação entre trabalhador e recrutador
- Aprovação de recrutadores
- Cadastro de vagas
- Edição de vagas
- Exclusão de vagas
- Visualização de vagas
- Filtros
- Demonstração de interesse
- Visualização dos interessados
- Controle de acesso
- Banco de dados
- Autenticação de usuários

## Tecnologias utilizadas

### Front-end

- HTML5
- CSS3
- JavaScript

### Banco de dados

- Supabase
- PostgreSQL

### Autenticação

- Supabase Authentication

### Hospedagem

- Netlify

### Controle de versão

- Git
- GitHub

## Banco de dados

O projeto utiliza o Supabase para armazenar as informações do sistema.

Entre as principais tabelas utilizadas estão:

- `profiles` — informações dos usuários;
- `jobs` — informações das vagas;
- `job_interests` — registros de interesse dos trabalhadores nas vagas.

O banco também possui regras de segurança para controlar o acesso às informações.

Por exemplo, um trabalhador não consegue visualizar a lista de interessados de uma vaga e um recrutador só consegue visualizar os interessados nas suas próprias vagas.

## Aprovação de recrutadores

Para evitar que qualquer usuário consiga publicar vagas como recrutador, o sistema possui um processo de aprovação.

Quando um novo recrutador se cadastra, sua conta fica inicialmente como não aprovada.

Depois da aprovação, ele passa a ter permissão para publicar e administrar suas vagas.

## Segurança

O projeto utiliza regras de acesso no Supabase para controlar as operações realizadas pelos usuários.

Entre os controles utilizados estão:

- Usuários só podem editar seu próprio perfil;
- Trabalhadores não podem criar vagas;
- Recrutadores precisam estar aprovados para publicar vagas;
- Recrutadores só podem alterar suas próprias vagas;
- Trabalhadores não conseguem visualizar os interessados de outras vagas;
- Recrutadores só conseguem acessar os perfis dos trabalhadores que demonstraram interesse em suas próprias vagas.

## Estrutura do projeto

```text
conecta-vagas/
│
├── index.html
├── style.css
├── app.js
└── README.md
