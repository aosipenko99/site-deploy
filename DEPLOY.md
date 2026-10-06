# Руководство по непрерывной доставке (CI/CD) и деплою в Production

Данный документ описывает полное решение тестового задания по организации непрерывной доставки (Continuous Delivery) Java веб-приложения на production-сервер.

---

## 1. Архитектура решения

Решение построено по модели **Zero-Downtime Blue/Green Deployment** под управлением **Jenkins** и **Ansible**:

```text
[ Разработчик / GitLab ]
           │ (git push / webhook)
           ▼
┌───────────────────────────────────────────────┐
│              Сборочный сервер                 │
│  - OpenJDK 21 + Maven 3.9                     │
│  - Jenkins Pipeline (запуск в одну кнопку)    │
│  - Сборка JAR: ./mvnw clean package           │
│  - Прогон тестов (DevopsTestTaskApplication)  │
│  - Ansible контроллер                         │
└──────────────────────┬────────────────────────┘
                       │ SSH (Ansible Playbook)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     Production-сервер                       │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                 Nginx (Reverse Proxy)               │   │
│   │       Порт 80 -> Upstream (127.0.0.1:8081/8082)     │   │
│   └──────────────────────┬──────────────────────────────┘   │
│                          │ Graceful reload (без даунтайма)  │
│              ┌───────────┴───────────┐                      │
│              ▼                       ▼                      │
│   [ Слот Blue: порт 8081 ]  [ Слот Green: порт 8082 ]       │
│   systemd unit:             systemd unit:                   │
│   devops-test-task@blue     devops-test-task@green          │
│   OpenJDK 21 (JRE)          OpenJDK 21 (JRE)                │
│   Юзер: devops-app          Юзер: devops-app                │
└─────────────────────────────────────────────────────────────┘
```

### Ключевые преимущества архитектуры:
1. **Zero-Downtime (без простоя)**: Новая версия стартует на свободном порту (8081 или 8082), пока текущая версия продолжает обрабатывать пользовательские запросы.
2. **Readiness Probe**: Переключение трафика в Nginx происходит только после того, как Spring Boot Actuator возвращает статус `UP` на `/actuator/health/readiness`.
3. **Мгновенный откат (Instant Rollback)**: Если после релиза обнаружена ошибка, откат выполняется в 1 клик через запуск Jenkins Pipeline с параметром `ACTION=rollback` (или запуском `ansible/rollback.yml`).
4. **Безопасность**: Приложение запускается из-под выделенного системного пользователя `devops-app` с ограниченными привилегиями (`NoNewPrivileges=true`, `ProtectSystem=full`, `ProtectHome=true`, `PrivateTmp=true`).

---

## 2. Структура проекта

```text
.
├── Jenkinsfile                     # Declarative Pipeline для сборки и деплоя в Jenkins
├── .gitlab-ci.yml                  # Конфигурация GitLab CI и интеграции с Jenkins
├── pom.xml                         # Конфигурация Maven сборки (Java 21, Spring Boot)
├── src/                            # Исходный код Java приложения и тесты
│   ├── main/
│   │   ├── java/ru/ptr/...
│   │   └── resources/
│   │       ├── application.yml     # Настройки Spring Boot (Actuator probes, port)
│   │       ├── static/main.jpg     # Картинка
│   │       └── web/index.html      # HTML страница
│   └── test/                       # Unit и интеграционные тесты
├── ansible/                        # Автоматизация деплоя и настройки серверов
│   ├── ansible.cfg                 # Конфигурация Ansible
│   ├── inventory.ini               # Инвентарь серверов (IP, пользователи)
│   ├── group_vars/all.yml          # Общие переменные (порты, пути)
│   ├── setup_server.yml            # Первичная настройка production сервера
│   ├── deploy.yml                  # Playbook непрерывного деплоя (Zero-Downtime)
│   └── rollback.yml                # Playbook быстрого отката
├── systemd/                        # Systemd сервисы
│   ├── devops-test-task@.service   # Шаблон systemd юнита для слотов blue/green
│   └── devops-test-task.service    # Одиночный systemd юнит
├── nginx/
│   └── devops-test-task.conf       # Nginx VirtualHost с проксированием и кэшированием
└── DEPLOY.md                       # Данная документация
```

---

## 3. Подготовка сборочного сервера (Jenkins)

На сборочном сервере должны быть установлены:
- **OpenJDK 21**
- **Maven**
- **Git**
- **Ansible**
- **Jenkins**

### 3.1. Установка пакетов и Jenkins (Debian / Ubuntu):
```bash
sudo apt update
sudo apt install -y openjdk-21-jdk maven git ansible curl rsync

# Установка Jenkins (используется актуальный ключ 2026 года):
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key | sudo gpg --dearmor -o /etc/apt/keyrings/jenkins-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.gpg] https://pkg.jenkins.io/debian-stable binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null

sudo apt update
sudo apt install -y jenkins
sudo systemctl enable --now jenkins
```

Если репозиторий выдает предупреждения, можно установить `.deb` пакет напрямую:
```bash
curl -fsSLO https://get.jenkins.io/debian-stable/jenkins_2.580.1_all.deb
sudo apt install -y ./jenkins_2.580.1_all.deb
```

### 3.2. Настройка SSH-доступа от Jenkins к Production серверу:
От имени пользователя `jenkins` сгенерируйте SSH ключ и скопируйте его на production-сервер:
```bash
sudo su - jenkins
ssh-keygen -t ed25519 -C "jenkins@build-server"
ssh-copy-id ubuntu@<IP_PRODUCTION_SERVER>

# Проверка входа без пароля:
ssh ubuntu@<IP_PRODUCTION_SERVER>
```

Пользователь `ubuntu` на production-сервере должен иметь права `sudo` без ввода пароля (`NOPASSWD: ALL` в `/etc/sudoers.d/ubuntu`).

### 3.3. Создание Pipeline в Jenkins:
1. Откройте веб-интерфейс Jenkins (`http://<BUILD_SERVER_IP>:8080`).
2. Создайте новый элемент -> **Pipeline** (название: `devops-test-task-deploy`).
3. В разделе **Build Triggers** включите:
   - *GitHub hook trigger* или *Build when a change is pushed to GitLab* (при интеграции с репозиторием).
4. В разделе **Pipeline**:
   - Definition: *Pipeline script from SCM*
   - SCM: *Git*
   - Repository URL: URL вашего git-репозитория
   - Credentials: добавьте учетные данные git (при необходимости)
   - Branch Specifier: `*/main`
   - Script Path: `Jenkinsfile`
5. Сохраните.

---

## 4. Подготовка Production сервера

Первичную подготовку production-сервера можно выполнить **автоматически** с помощью одного Ansible playbook:

1. В файле `ansible/inventory.ini` укажите реальный IP вашего production сервера:
   ```ini
   [production]
   prod-server ansible_host=203.0.113.10 ansible_user=ubuntu
   ```
2. Запустите playbook первичной настройки:
   ```bash
   ansible-playbook -i ansible/inventory.ini ansible/setup_server.yml
   ```

### Что делает `setup_server.yml`:
- Устанавливает `openjdk-21-jre-headless`, `nginx`, `curl`, `rsync`.
- Создает системного пользователя и группу `devops-app`.
- Создает каталоги `/opt/devops-test-task/blue`, `/opt/devops-test-task/green`.
- Устанавливает systemd шаблон `devops-test-task@.service`.
- Настраивает и запускает Nginx на 80 порту.

---

## 5. Процесс доставки (Деплой)

### Вариант А: Запуск в одну кнопку из Jenkins (Основное требование)
1. Зайдите в задачу `devops-test-task-deploy` в Jenkins.
2. Нажмите **Собрать с параметрами** (Build with Parameters):
   - `ACTION`: `deploy`
   - `TARGET_HOST`: IP-адрес production сервера
   - `SKIP_TESTS`: `false`
3. Нажмите кнопку **Собрать** (Build).
4. Jenkins автоматически:
   - Склонирует свежий код;
   - Соберет проект командой `mvn clean package` с OpenJDK 21;
   - Запустит тесты;
   - Заархивирует созданный JAR артефакт;
   - Передаст управление Ansible playbook `ansible/deploy.yml`;
   - Проверит readiness probe и переключит трафик в Nginx;
   - Выполнит smoke-тест на production сервере (`HTTP GET /` -> 200 OK).

### Вариант Б: Ручной деплой через Ansible (при необходимости)
```bash
# Сборка JAR локально
mvn clean package

# Запуск деплоя
ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
```

---

## 6. Как работает Zero-Downtime и Readiness Probe

1. Playbook считывает текущий активный слот из `/opt/devops-test-task/active_slot` (например, `blue` на порту 8081).
2. Новый JAR копируется в каталог неактивного слота (например, `green` на порту 8082).
3. Systemd перезапускает службу неактивного слота:
   `systemctl restart devops-test-task@green.service`
4. Ansible циклически опрашивает Readiness Probe:
   `GET http://127.0.0.1:8082/actuator/health/readiness`
   До подтверждения статуса `{"status":"UP"}` и кода `200 OK`.
5. Только после успешного старта Nginx плавно переключает upstream на порт 8082:
   `nginx -s reload` (процесс мастер-воркеров Nginx не прерывает текущие соединения).
6. Старый слот (`blue`) останавливается.

---

## 7. Быстрый откат на предыдущую версию (Rollback)

Если в новой версии обнаружен дефект:
1. В Jenkins выберите **Собрать с параметрами**.
2. Укажите `ACTION`: `rollback`.
3. Нажмите **Собрать**.

Либо выполните команду:
```bash
ansible-playbook -i ansible/inventory.ini ansible/rollback.yml
```
Ansible мгновенно запустит предыдущий слот, дождется его готовности, переключит Nginx обратно и остановит сбойную версию.

---

## 8. Проверка работоспособности (Smoke Verification)

После завершения деплоя выполните проверку с любого внешнего хоста:

```bash
# 1. Проверка главного эндпоинта (требование: 200 OK и HTML тело)
curl -i http://<PRODUCTION_IP>/

# Ожидаемый результат:
# HTTP/1.1 200 OK
# Content-Type: text/html;charset=UTF-8
# <h1>DevOps test task</h1>
# <img src="/main.jpg" alt="main.jpg">

# 2. Проверка отдачи статики (картинки)
curl -i http://<PRODUCTION_IP>/main.jpg
# Ожидаемый результат: HTTP/1.1 200 OK, Content-Type: image/jpeg

# 3. Проверка Healthcheck Actuator
curl -s http://<PRODUCTION_IP>/actuator/health
# Ожидаемый результат: {"status":"UP",...}
```

---

## 9. Дополнительно: Интеграция GitLab ↔ Jenkins (Excellent+)

В репозитории подготовлен файл `.gitlab-ci.yml`. При отправке коммитов в ветку `main`:
1. GitLab запускает тестирование проекта.
2. При успешном тесте GitLab триггерит Jenkins Job через REST API:
   `POST http://<JENKINS_URL>/job/devops-test-task-deploy/buildWithParameters?token=<TOKEN>`
3. Jenkins выполняет сборку и деплой на Production сервер.
