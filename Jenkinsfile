pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '15'))
        timestamps()
        timeout(time: 20, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    parameters {
        choice(name: 'ACTION', choices: ['deploy', 'rollback'], description: 'Select deployment action')
        string(name: 'TARGET_HOST', defaultValue: '161.104.54.182', description: 'Production server IP or hostname')
        booleanParam(name: 'SKIP_TESTS', defaultValue: false, description: 'Skip Maven tests during build')
    }

    environment {
        APP_NAME = 'devops-test-task'
        ANSIBLE_FORCE_COLOR = 'true'
        ANSIBLE_HOST_KEY_CHECKING = 'False'
        PROD_HOST = "${params.TARGET_HOST}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Test Application') {
            when {
                expression { return params.ACTION == 'deploy' }
            }
            steps {
                echo "Building application with OpenJDK 21 and Maven..."
                sh '''
                    if [ -f "./mvnw" ]; then
                        chmod +x ./mvnw
                        ./mvnw clean package -DskipTests=${SKIP_TESTS}
                    else
                        mvn clean package -DskipTests=${SKIP_TESTS}
                    fi
                '''
            }
        }

        stage('Archive Artifacts') {
            when {
                expression { return params.ACTION == 'deploy' }
            }
            steps {
                archiveArtifacts artifacts: 'target/*.jar', fingerprint: true, allowEmptyArchive: false
            }
        }

        stage('Deploy to Production via Ansible') {
            when {
                expression { return params.ACTION == 'deploy' }
            }
            steps {
                echo "Deploying to production server (${PROD_HOST}) using Ansible Zero-Downtime Playbook..."
                sh '''
                    ansible-playbook -i ansible/inventory.ini ansible/deploy.yml \
                        --extra-vars "ansible_host=${PROD_HOST}"
                '''
            }
        }

        stage('Instant Rollback') {
            when {
                expression { return params.ACTION == 'rollback' }
            }
            steps {
                echo "Executing instant rollback on production (${PROD_HOST})..."
                sh '''
                    ansible-playbook -i ansible/inventory.ini ansible/rollback.yml \
                        --extra-vars "ansible_host=${PROD_HOST}"
                '''
            }
        }

        stage('Production Smoke Verification') {
            steps {
                echo "Verifying application availability on production..."
                sh '''
                    echo "Checking health endpoint..."
                    curl -fsS --retry 5 --retry-delay 2 "http://${PROD_HOST}/actuator/health" | grep -q '"status":"UP"'
                    
                    echo "Checking readiness probe..."
                    curl -fsS --retry 5 --retry-delay 2 "http://${PROD_HOST}/actuator/health/readiness" | grep -q '"status":"UP"'
                    
                    echo "Checking main page..."
                    RESPONSE=$(curl -fsS --retry 5 --retry-delay 2 -i "http://${PROD_HOST}/")
                    echo "$RESPONSE" | grep -E -q "HTTP/[0-9.]+ 200"
                    echo "$RESPONSE" | grep -q "DevOps test task"
                    echo "$RESPONSE" | grep -q "main.jpg"
                    
                    echo "Smoke tests passed successfully! Status 200 OK with HTML body verified."
                '''
            }
        }
    }

    post {
        always {
            cleanWs notFailBuild: true
        }
        success {
            echo "Pipeline finished successfully! Application is live on http://${PROD_HOST}/"
        }
        failure {
            echo "Pipeline failed! Please check logs above."
        }
    }
}
