package com.shmamsa;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ShmamsaApplication {

	public static void main(String[] args) {

		SpringApplication.run(ShmamsaApplication.class, args);
	}

}
