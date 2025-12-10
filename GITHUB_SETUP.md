# GitHub Setup & Push Instructions

Your local Git repository has been initialized and all files are committed. Now you need to authenticate with GitHub and push your code.

---

## Current Status

✅ Git repository initialized
✅ Initial commit created (115 files, 20,008 lines)
✅ GitHub remote added: `https://github.com/makriman/inspir.git`
⏳ Ready to push to GitHub

---

## Option 1: Using Personal Access Token (Recommended)

### 1. Generate a Personal Access Token

1. Go to GitHub: https://github.com/settings/tokens
2. Click **"Generate new token"** > **"Generate new token (classic)"**
3. Give it a descriptive name: `inspir-server-deploy`
4. Set expiration (recommend: 90 days or No expiration)
5. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `workflow` (if using GitHub Actions)
6. Click **"Generate token"**
7. **Copy the token immediately** (you won't see it again!)

### 2. Configure Git to Use the Token

```bash
# Store credentials (token will be cached)
git config --global credential.helper store

# Push to GitHub (you'll be prompted for credentials)
cd /root/inspir
git push -u origin main

# When prompted:
# Username: your-github-username
# Password: paste-your-personal-access-token-here
```

After the first push, Git will remember your credentials.

---

## Option 2: Using SSH Keys

### 1. Generate SSH Key

```bash
# Generate a new SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Press Enter to accept default location (~/.ssh/id_ed25519)
# Set a passphrase (or press Enter for no passphrase)

# Start the SSH agent
eval "$(ssh-agent -s)"

# Add your SSH key
ssh-add ~/.ssh/id_ed25519

# Copy the public key
cat ~/.ssh/id_ed25519.pub
```

### 2. Add SSH Key to GitHub

1. Copy the output from the `cat` command above
2. Go to GitHub: https://github.com/settings/keys
3. Click **"New SSH key"**
4. Title: `inspir-server`
5. Paste your public key
6. Click **"Add SSH key"**

### 3. Change Remote to SSH

```bash
cd /root/inspir

# Change remote URL from HTTPS to SSH
git remote set-url origin git@github.com:makriman/inspir.git

# Verify the remote
git remote -v

# Push to GitHub
git push -u origin main
```

---

## Option 3: Using GitHub CLI

### 1. Install GitHub CLI

```bash
# Install gh CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh
```

### 2. Authenticate and Push

```bash
# Authenticate with GitHub
gh auth login

# Follow the prompts to authenticate

# Push to GitHub
cd /root/inspir
git push -u origin main
```

---

## Verify Push Success

After successfully pushing, verify on GitHub:

1. Visit: https://github.com/makriman/inspir
2. You should see all 115 files
3. Check that the README displays correctly
4. Verify no sensitive files (.env) were committed

---

## Future Deployments

After the initial push, you can push future changes with:

```bash
cd /root/inspir

# Pull latest changes (if working with others)
git pull origin main

# Stage all changes
git add .

# Commit changes
git commit -m "Your commit message here"

# Push to GitHub
git push origin main
```

---

## Automated Deployment Workflow

### 1. Make Changes to Code

```bash
cd /root/inspir
# Edit files as needed
```

### 2. Test Changes Locally

```bash
# Test backend
cd backend
npm run dev

# Test frontend
cd frontend
npm run dev
```

### 3. Commit and Push to GitHub

```bash
cd /root/inspir

# Stage changes
git add .

# Commit with descriptive message
git commit -m "Description of your changes"

# Push to GitHub
git push origin main
```

### 4. Deploy to Production Server

```bash
# Pull latest changes
cd /root/inspir
git pull origin main

# Run deployment script
./deploy.sh
```

The deployment script will:
- Build the frontend
- Copy files to `/var/www/quiz.inspir.uk/`
- Reload nginx
- Optionally restart the backend

---

## Git Best Practices

### Commit Message Guidelines

Use clear, descriptive commit messages:

```bash
# Good examples:
git commit -m "Add forum post deletion feature"
git commit -m "Fix quiz timer not stopping on submit"
git commit -m "Update README with deployment instructions"

# Bad examples:
git commit -m "update"
git commit -m "fix bug"
git commit -m "changes"
```

### Before Committing

Always check what's being committed:

```bash
# View status
git status

# View changes
git diff

# View staged changes
git diff --cached
```

### Never Commit

- `.env` files with real credentials
- `node_modules/` directories
- Build outputs (`dist/`, `build/`)
- API keys or secrets
- Database dumps with sensitive data

These are already in `.gitignore`, but always double-check!

---

## Branching Strategy (Optional)

For more organized development:

### Create Feature Branches

```bash
# Create a new feature branch
git checkout -b feature/new-quiz-type

# Make changes and commit
git add .
git commit -m "Add true/false question type"

# Push feature branch
git push origin feature/new-quiz-type

# Merge to main when ready
git checkout main
git merge feature/new-quiz-type
git push origin main
```

### Create Release Tags

```bash
# Tag a release
git tag -a v1.0.0 -m "Release version 1.0.0"

# Push tags to GitHub
git push origin --tags
```

---

## Troubleshooting

### "Authentication failed"

- **For HTTPS:** Check your Personal Access Token is valid and has correct scopes
- **For SSH:** Verify your SSH key is added to GitHub: `ssh -T git@github.com`

### "Permission denied"

- Make sure you have push access to the repository
- Verify you're using the correct GitHub account

### "Repository not found"

- Check the remote URL: `git remote -v`
- Verify the repository exists: https://github.com/makriman/inspir

### "Failed to push some refs"

```bash
# Pull latest changes first
git pull origin main --rebase

# Then push
git push origin main
```

### "Divergent branches"

```bash
# If remote has changes you don't have locally
git pull origin main

# Resolve any conflicts, then push
git push origin main
```

---

## Additional Resources

- [GitHub Docs - Authentication](https://docs.github.com/en/authentication)
- [GitHub Docs - SSH Keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- [Git Basics](https://git-scm.com/book/en/v2/Getting-Started-Git-Basics)
- [GitHub CLI Documentation](https://cli.github.com/manual/)

---

**Next Steps:**

1. Choose your authentication method (Personal Access Token, SSH, or GitHub CLI)
2. Follow the steps above to authenticate
3. Run `git push -u origin main`
4. Verify your code is on GitHub
5. Start developing and pushing updates regularly!

---

**Remember:** Always pull before you push, and never commit sensitive data!
