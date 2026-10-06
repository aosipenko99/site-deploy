# site-deploy — Непрерывная доставка Java-приложения на Production

Проект непрерывной доставки (Continuous Delivery) веб-приложения на **Java 21 / Spring Boot** с использованием **Jenkins**, **Ansible**, **systemd** и **Nginx (Reverse Proxy)** по архитектуре **Zero-Downtime Blue/Green Deployment**.

Подробное руководство по развертыванию и настройке: [DEPLOY.md](./DEPLOY.md).

## Выполненные требования тестового задания

- [x] Использование **OpenJDK 21** и **Maven** для сборки приложения (`pom.xml`, `Jenkinsfile`).
- [x] Автоматизация процесса доставки с помощью **Jenkins** (Declarative Pipeline в `Jenkinsfile`).
- [x] Запуск в **одну кнопку** («Собрать с параметрами»).
- [x] Запуск приложения как защищенного **systemd-сервиса** (`systemd/devops-test-task@.service`).
- [x] Использование **Nginx** в качестве reverse proxy (`nginx/devops-test-task.conf`).
- [x] Максимальная автоматизация через **Ansible** (`ansible/setup_server.yml`, `ansible/deploy.yml`).
- [x] Проверка отдачи `GET /` с кодом `200 OK` и HTML-телом.

### Дополнительные задания (Excellent+)

- [x] Доставка на production с использованием **Ansible** (`ansible/deploy.yml`).
- [x] **Zero-Downtime** обновление без простоя пользователей (Blue/Green слоты).
- [x] Использование **Readiness-проверки** (`/actuator/health/readiness`) перед переключением Nginx upstream.
- [x] Мгновенный откат (**Instant Rollback**) в один клик (`ansible/rollback.yml`).
- [x] Файл `.gitlab-ci.yml` для интеграции **GitLab ↔ Jenkins**.

## Быстрый старт

### 1. Первичная настройка production сервера (Ansible)
```bash
ansible-playbook -i ansible/inventory.ini ansible/setup_server.yml
```

### 2. Сборка и деплой
- **Через Jenkins**: Запустить pipeline `Jenkinsfile` кнопкой «Build with Parameters» (`ACTION=deploy`).
- **Вручную через Ansible**:
  ```bash
  mvn clean package
  ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
  ```

### 3. Проверка работоспособности
```bash
curl -i http://<PRODUCTION_IP>/
curl -i http://<PRODUCTION_IP>/main.jpg
curl -s http://<PRODUCTION_IP>/actuator/health
```


