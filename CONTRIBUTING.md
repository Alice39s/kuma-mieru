# Contributing to Kuma Mieru

Thank you for considering contributing to Kuma Mieru! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We want to foster an inclusive and welcoming community.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/kuma-mieru.git
   cd kuma-mieru
   ```
3. Add the original repository as an upstream remote:
   ```bash
   git remote add upstream https://github.com/Alice39s/kuma-mieru.git
   ```
4. Install dependencies:
   ```bash
   bun install
   ```

## Development Workflow

1. Create a new branch for your feature or bugfix:

   ```bash
   git checkout -b feature/amazing-feature
   # or
   git checkout -b fix/bug-description
   ```

2. Make your changes

3. Run the development server to test your changes:

   ```bash
   bun run dev
   ```

4. Make sure your code follows the project's coding standards. `lint` runs Oxlint with type-aware rules and the TypeScript type check; `lint:fix` applies Oxlint fixes and formats with Oxfmt:

   ```bash
   bun run lint:fix
   bun run lint
   bun run test
   ```

5. Commit your changes with a descriptive commit message:

   ```bash
   git commit -m 'feat(component): add some amazing feature'
   ```

   Follow the conventional commit format:
   - `feat`: A new feature
   - `fix`: A bug fix
   - `docs`: Documentation changes
   - `style`: Changes that do not affect the meaning of the code (formatting, etc.)
   - `refactor`: Code changes that neither fix a bug nor add a feature
   - `perf`: Performance improvements
   - `test`: Adding or correcting tests
   - `chore`: Changes to the build process or auxiliary tools

6. Push to your fork:

   ```bash
   git push origin feature/amazing-feature
   ```

7. Create a Pull Request from your fork to the main repository

## Pull Request Guidelines

- Keep your PR focused on a single issue or feature
- Write clear descriptions of what your PR accomplishes
- Include screenshots for UI changes if possible
- Ensure your code passes all linting and formatting checks
- Make sure your code works in both light and dark themes
- Keep your PR up-to-date with the main branch by rebasing

## Code Style and Structure

### General Principles

- Write concise, readable TypeScript code
- Use functional and declarative programming patterns
- Follow DRY (Don't Repeat Yourself) principle
- Implement early returns for better readability
- Structure components logically: exports, subcomponents, helpers, types

### Naming Conventions

- Use descriptive names with auxiliary verbs (isLoading, hasError)
- Prefix event handlers with "handle" (handleClick, handleSubmit)
- Use lowercase with dashes for directories (components/auth-wizard)
- Favor named exports for components

### TypeScript Usage

- Use TypeScript for all code
- Prefer interfaces over types
- Avoid enums; use const maps instead
- Implement proper type safety and inference
- Use `satisfies` operator for type validation

### React 19 and Next.js 16 Best Practices

- Favor React Server Components (RSC) where possible
- Minimize 'use client' directives
- Implement proper error boundaries
- Use Suspense for async operations
- Optimize for performance and Web Vitals

## Testing

- Write tests for your code when applicable
- Ensure your changes don't break existing functionality

## Documentation

- Update the docs site pages in `apps/docs/content/docs` (Chinese `page.mdx` and English `page.en.mdx`) if your changes affect the project's functionality
- Follow `apps/docs/design.md` when you change the docs site interface
- Document your components with descriptive comments

## I18n

### Update the i18n translations

- Update the messages in the `apps/web/messages/` folder

### Add your language to the i18n

- Add your language to the locales array in the `apps/web/utils/i18n/config.ts` file
- Add your language to the languages json file in the `apps/web/messages/` folder, example: `apps/web/messages/en-US.json`

## Questions?

If you have any questions or need help with your contribution, feel free to open an issue asking for guidance.

Thank you for contributing to Kuma Mieru!
