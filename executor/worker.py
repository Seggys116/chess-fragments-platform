from celery import Celery
import os

app = Celery('fragmentarena')
app.config_from_object('celeryconfig')
app.autodiscover_tasks(['tasks'], force=True)

if __name__ == '__main__':
    app.start()
